// Temporary debug endpoint — test a single VTODO PUT and return full details
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { calFetch, authHeader, discoverHomeUrl } from "@/lib/caldav/client";

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function normalizeListName(name: string): string {
  return name.replace(/[\u26A0\uFE0F\s]+$/, "").trim();
}
function toAbsolute(href: string, base: string): string {
  if (href.startsWith("http")) return href;
  const u = new URL(base);
  return `${u.protocol}//${u.host}${href}`;
}
function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : url + "/";
}

export async function GET(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const homeUrl = await discoverHomeUrl();

  // List all VTODO collections
  const listRes = await calFetch(homeUrl, "PROPFIND", {
    Depth: "1",
    "Content-Type": "application/xml; charset=utf-8",
    Accept: "application/xml",
  }, `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/></d:prop>
</d:propfind>`);

  const listText = await listRes.text();
  const blocks = listText.match(/<[A-Za-z0-9]*:?response[\s\S]*?<\/[A-Za-z0-9]*:?response>/g) ?? [];
  const vtodoLists: { href: string; rawName: string; normalizedName: string; url: string }[] = [];

  for (const block of blocks) {
    if (!block.includes("VTODO")) continue;
    const hrefM = block.match(/<[A-Za-z0-9]*:?href[^>]*>([^<]+)<\/[A-Za-z0-9]*:?href>/i);
    if (!hrefM) continue;
    const href = hrefM[1].trim();
    const rawName = decodeEntities(
      block.match(/<[A-Za-z0-9]*:?displayname[^>]*>([^<]*)<\/[A-Za-z0-9]*:?displayname>/i)?.[1]?.trim() ?? ""
    );
    vtodoLists.push({
      href,
      rawName,
      normalizedName: normalizeListName(rawName),
      url: ensureTrailingSlash(toAbsolute(href, homeUrl)),
    });
  }

  // Find "Grocery List"
  const groceryList = vtodoLists.find(l => l.normalizedName.toLowerCase() === "grocery list");

  if (!groceryList) {
    return NextResponse.json({ homeUrl, vtodoLists, groceryList: null, putTest: null });
  }

  // Try a test PUT
  const uid = `test-${crypto.randomUUID()}`;
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";
  const ical = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "PRODID:-//Sonny//Personal AI//EN",
    "BEGIN:VTODO",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    "SUMMARY:Test item from debug endpoint",
    "STATUS:NEEDS-ACTION",
    "END:VTODO",
    "END:VCALENDAR",
  ].join("\r\n") + "\r\n";

  const putUrl = `${groceryList.url}${uid}.ics`;
  const putRes = await calFetch(putUrl, "PUT", {
    "Content-Type": "text/calendar; charset=utf-8",
  }, ical);

  const putBody = await putRes.text().catch(() => "");

  // Clean up — delete the test item
  if (putRes.ok || putRes.status === 201) {
    await calFetch(putUrl, "DELETE", { Authorization: authHeader() }).catch(() => {});
  }

  return NextResponse.json({
    homeUrl,
    vtodoLists,
    groceryList,
    putTest: {
      url: putUrl,
      status: putRes.status,
      ok: putRes.ok,
      body: putBody.slice(0, 500),
    },
  });
}
