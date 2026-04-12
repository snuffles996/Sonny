// Temporary debug endpoint — find the real Reminders home URL
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { calFetch, discoverHomeUrl } from "@/lib/caldav/client";

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
  // Principal is one level up: https://p54-caldav.icloud.com/1054634798/
  const principalUrl = homeUrl.replace(/\/calendars\/?$/, "/").replace(/:443/, "");

  // 1. allprop on principal to find all available home sets / properties
  const principalRes = await calFetch(principalUrl, "PROPFIND", {
    Depth: "0",
    "Content-Type": "application/xml; charset=utf-8",
    Accept: "application/xml",
  }, `<?xml version="1.0" encoding="UTF-8"?><d:propfind xmlns:d="DAV:"><d:allprop/></d:propfind>`);
  const principalXml = await principalRes.text();

  // 2. Depth:2 PROPFIND on home to find nested collections
  const depth2Res = await calFetch(homeUrl, "PROPFIND", {
    Depth: "2",
    "Content-Type": "application/xml; charset=utf-8",
    Accept: "application/xml",
  }, `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/></d:prop>
</d:propfind>`);
  const depth2Xml = await depth2Res.text();

  // Extract all collections from depth2
  const blocks = depth2Xml.match(/<[A-Za-z0-9]*:?response[\s\S]*?<\/[A-Za-z0-9]*:?response>/g) ?? [];
  const depth2Collections: { href: string; name: string; hasVTODO: boolean; hasVEVENT: boolean }[] = [];
  for (const block of blocks) {
    const href = block.match(/<[A-Za-z0-9]*:?href[^>]*>([^<]+)<\/[A-Za-z0-9]*:?href>/i)?.[1]?.trim() ?? "";
    const name = block.match(/<[A-Za-z0-9]*:?displayname[^>]*>([^<]*)<\/[A-Za-z0-9]*:?displayname>/i)?.[1]?.trim() ?? "";
    depth2Collections.push({
      href,
      name,
      hasVTODO: block.includes("VTODO"),
      hasVEVENT: block.includes("VEVENT"),
    });
  }

  // 3. Search for "Test" item in all VTODO collections at depth2
  const vtodoCols = depth2Collections.filter(c => c.hasVTODO);
  const testSearch: { href: string; name: string; itemCount: number; hasTest: boolean }[] = [];

  for (const col of vtodoCols) {
    const url = ensureTrailingSlash(toAbsolute(col.href, homeUrl));
    const rptRes = await calFetch(url, "REPORT", {
      Depth: "1",
      "Content-Type": "application/xml; charset=utf-8",
      Accept: "application/xml",
    }, `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO"/></c:comp-filter></c:filter>
</c:calendar-query>`);
    if (!rptRes.ok && rptRes.status !== 207) { testSearch.push({ href: col.href, name: col.name, itemCount: -1, hasTest: false }); continue; }
    const rptText = await rptRes.text();
    const sumRe = /^SUMMARY:(.+)$/gm;
    const summaries: string[] = [];
    let sm: RegExpExecArray | null;
    while ((sm = sumRe.exec(rptText)) !== null) summaries.push(sm[1].trim());
    testSearch.push({ href: col.href, name: col.name, itemCount: summaries.length, hasTest: summaries.some(s => s.toLowerCase().includes("test")) });
  }

  // Trim principal XML to manageable size
  const principalXmlTrimmed = principalXml.slice(0, 3000);

  return NextResponse.json({
    homeUrl,
    principalUrl,
    principalXmlTrimmed,
    vtodoCount: vtodoCols.length,
    depth2Collections,
    testSearch,
  });
}
