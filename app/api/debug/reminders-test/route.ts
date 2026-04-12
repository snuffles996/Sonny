// Temporary debug endpoint — find real Reminders home by searching for Test item
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

async function propfindXml(url: string, body: string, depth = "1"): Promise<string> {
  const res = await calFetch(url, "PROPFIND", {
    Depth: depth,
    "Content-Type": "application/xml; charset=utf-8",
    Accept: "application/xml",
  }, body);
  return res.text();
}

export async function GET(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const homeUrl = await discoverHomeUrl();

  // Step 1: PROPFIND on the principal URL to find ALL home sets
  const principalPropfind = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <c:calendar-home-set/>
    <d:displayname/>
    <d:principal-URL/>
  </d:prop>
</d:propfind>`;

  // Principal URL is one level up from the home
  const principalUrl = homeUrl.replace(/\/calendars\/$/, "/");
  const principalXml = await propfindXml(principalUrl, principalPropfind, "0");

  // Extract all href values from the principal response
  const hrefRe = /<[A-Za-z0-9]*:?href[^>]*>([^<]+)<\/[A-Za-z0-9]*:?href>/gi;
  const allHrefs: string[] = [];
  let hrefM: RegExpExecArray | null;
  while ((hrefM = hrefRe.exec(principalXml)) !== null) allHrefs.push(hrefM[1].trim());

  // Step 2: PROPFIND the home with Depth:1 to get all collections
  const collectionPropfind = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <c:supported-calendar-component-set/>
  </d:prop>
</d:propfind>`;

  const homeXml = await propfindXml(homeUrl, collectionPropfind, "1");
  const responseBlocks = homeXml.match(/<[A-Za-z0-9]*:?response[\s\S]*?<\/[A-Za-z0-9]*:?response>/g) ?? [];

  const allCollections: { href: string; name: string; types: string[] }[] = [];
  for (const block of responseBlocks) {
    const href = block.match(/<[A-Za-z0-9]*:?href[^>]*>([^<]+)<\/[A-Za-z0-9]*:?href>/i)?.[1]?.trim() ?? "";
    const name = block.match(/<[A-Za-z0-9]*:?displayname[^>]*>([^<]*)<\/[A-Za-z0-9]*:?displayname>/i)?.[1]?.trim() ?? "";
    const compRe = /name="([A-Z]+)"/g;
    const compMatches: string[] = [];
    let cm: RegExpExecArray | null;
    while ((cm = compRe.exec(block)) !== null) compMatches.push(cm[1]);
    allCollections.push({ href, name, types: compMatches });
  }

  // Step 3: REPORT each VTODO collection looking for the "Test" item
  const vtodoCollections = allCollections.filter(c => c.types.includes("VTODO"));
  const testItemSearch: { collection: string; name: string; found: boolean; itemCount: number }[] = [];

  for (const col of vtodoCollections) {
    const url = ensureTrailingSlash(toAbsolute(col.href, homeUrl));
    const reportRes = await calFetch(url, "REPORT", {
      Depth: "1",
      "Content-Type": "application/xml; charset=utf-8",
      Accept: "application/xml",
    }, `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VTODO"/>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`);

    if (!reportRes.ok && reportRes.status !== 207) {
      testItemSearch.push({ collection: col.href, name: col.name, found: false, itemCount: -1 });
      continue;
    }
    const reportText = await reportRes.text();
    const sumRe = /^SUMMARY:(.+)$/gm;
    const summaries: string[] = [];
    let sm: RegExpExecArray | null;
    while ((sm = sumRe.exec(reportText)) !== null) summaries.push(sm[1].trim());
    const hasTest = summaries.some(s => s.toLowerCase().includes("test"));
    testItemSearch.push({ collection: col.href, name: col.name, found: hasTest, itemCount: summaries.length });
  }

  return NextResponse.json({
    homeUrl,
    principalUrl,
    principalHrefs: allHrefs,
    allCollections,
    vtodoCollections: vtodoCollections.length,
    testItemSearch,
  });
}
