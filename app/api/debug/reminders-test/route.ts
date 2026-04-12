// Temporary debug endpoint — test Reminders PUT and show existing items
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

  const groceryList = vtodoLists.find(l => l.normalizedName.toLowerCase() === "grocery list");
  if (!groceryList) {
    return NextResponse.json({ homeUrl, vtodoLists, groceryList: null });
  }

  // Get existing items with their actual hrefs (not reconstructed from UID)
  const reportRes = await calFetch(groceryList.url, "REPORT", {
    Depth: "1",
    "Content-Type": "application/xml; charset=utf-8",
    Accept: "application/xml",
  }, `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><d:href/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VTODO"/>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`);

  const reportText = await reportRes.text();
  const responseBlocks = reportText.match(/<[A-Za-z0-9]*:?response[\s\S]*?<\/[A-Za-z0-9]*:?response>/g) ?? [];
  const existingItems: { href: string; uid: string; summary: string; status: string; rawCalData: string }[] = [];

  for (const block of responseBlocks) {
    const hrefM = block.match(/<[A-Za-z0-9]*:?href[^>]*>([^<]+)<\/[A-Za-z0-9]*:?href>/i);
    const calDataM = block.match(/<[A-Za-z0-9]*:?calendar-data[^>]*>([\s\S]*?)<\/[A-Za-z0-9]*:?calendar-data>/i);
    if (!calDataM) continue;
    const calData = calDataM[1];
    const uid = calData.match(/^UID:(.+)$/m)?.[1]?.trim() ?? "";
    const summary = calData.match(/^SUMMARY:(.+)$/m)?.[1]?.trim() ?? "";
    const status = calData.match(/^STATUS:(.+)$/m)?.[1]?.trim() ?? "NONE";
    existingItems.push({ href: hrefM?.[1]?.trim() ?? "", uid, summary, status, rawCalData: calData.trim() });
  }

  // Test 1: PUT with uuid@sonny format (actual addReminder format)
  const uid1 = `${crypto.randomUUID()}@sonny`;
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";
  const ical1 = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "PRODID:-//Sonny//Personal AI//EN",
    "BEGIN:VTODO",
    `UID:${uid1}`,
    `DTSTAMP:${stamp}`,
    "SUMMARY:Cheddar-jack cheese: 4 oz",
    "STATUS:NEEDS-ACTION",
    "END:VTODO",
    "END:VCALENDAR",
  ].join("\r\n") + "\r\n";

  const putUrl1 = `${groceryList.url}${uid1}.ics`;
  const putRes1 = await calFetch(putUrl1, "PUT", { "Content-Type": "text/calendar; charset=utf-8" }, ical1);
  const putBody1 = await putRes1.text().catch(() => "");
  if (putRes1.ok || putRes1.status === 201) {
    await calFetch(putUrl1, "DELETE", { Authorization: authHeader() }).catch(() => {});
  }

  // Test 2: PUT with plain uuid (no @sonny)
  const uid2 = crypto.randomUUID();
  const ical2 = ical1.replace(`UID:${uid1}`, `UID:${uid2}`);
  const putUrl2 = `${groceryList.url}${uid2}.ics`;
  const putRes2 = await calFetch(putUrl2, "PUT", { "Content-Type": "text/calendar; charset=utf-8" }, ical2);
  const putBody2 = await putRes2.text().catch(() => "");
  if (putRes2.ok || putRes2.status === 201) {
    await calFetch(putUrl2, "DELETE", { Authorization: authHeader() }).catch(() => {});
  }

  return NextResponse.json({
    homeUrl,
    groceryList,
    existingItems,
    putTestAtSonny: { url: putUrl1, status: putRes1.status, ok: putRes1.ok, body: putBody1.slice(0, 500) },
    putTestPlainUuid: { url: putUrl2, status: putRes2.status, ok: putRes2.ok, body: putBody2.slice(0, 500) },
  });
}
