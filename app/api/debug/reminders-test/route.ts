// Temporary debug endpoint — discover collections on reminders.icloud.com
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { authHeader } from "@/lib/caldav/client";

const BASES = [
  "https://caldav.icloud.com",
  "https://reminders.icloud.com",
];

async function calFetchRaw(url: string, method: string, headers: Record<string, string>, body?: string): Promise<Response> {
  let current = url;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(current, {
      method,
      headers: { ...headers, Authorization: authHeader() },
      body,
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`Redirect with no Location from ${current}`);
      current = loc.startsWith("http") ? loc : new URL(loc, current).href;
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}

async function discoverHome(base: string): Promise<{ homeUrl: string | null; principalUrl: string | null; status: number; rawXml: string }> {
  try {
    const res = await calFetchRaw(base, "PROPFIND", {
      Depth: "0",
      "Content-Type": "application/xml; charset=utf-8",
      Accept: "application/xml",
    }, `<?xml version="1.0" encoding="UTF-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`);

    const xml = await res.text();
    const principalM = xml.match(/<[A-Za-z0-9]*:?current-user-principal[^>]*>[\s\S]*?<[A-Za-z0-9]*:?href[^>]*>([^<]+)<\/[A-Za-z0-9]*:?href>/i);
    const principalHref = principalM?.[1]?.trim() ?? null;
    if (!principalHref) return { homeUrl: null, principalUrl: null, status: res.status, rawXml: xml.slice(0, 1000) };

    const principalUrl = principalHref.startsWith("http") ? principalHref : `${new URL(base).protocol}//${new URL(base).host}${principalHref}`;

    const res2 = await calFetchRaw(principalUrl, "PROPFIND", {
      Depth: "0",
      "Content-Type": "application/xml; charset=utf-8",
      Accept: "application/xml",
    }, `<?xml version="1.0" encoding="UTF-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`);
    const xml2 = await res2.text();
    const homeM = xml2.match(/<[A-Za-z0-9]*:?calendar-home-set[^>]*>[\s\S]*?<[A-Za-z0-9]*:?href[^>]*>([^<]+)<\/[A-Za-z0-9]*:?href>/i);
    const homeHref = homeM?.[1]?.trim() ?? null;
    const homeUrl = homeHref ? (homeHref.startsWith("http") ? homeHref : `${new URL(principalUrl).protocol}//${new URL(principalUrl).host}${homeHref}`) : null;

    return { homeUrl, principalUrl, status: res.status, rawXml: xml2.slice(0, 1000) };
  } catch (e) {
    return { homeUrl: null, principalUrl: null, status: -1, rawXml: String(e) };
  }
}

export async function GET(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const results: Record<string, unknown> = {};

  for (const base of BASES) {
    const discovery = await discoverHome(base);
    if (!discovery.homeUrl) {
      results[base] = { error: "discovery failed", ...discovery };
      continue;
    }

    // List all VTODO collections
    const listRes = await calFetchRaw(discovery.homeUrl, "PROPFIND", {
      Depth: "1",
      "Content-Type": "application/xml; charset=utf-8",
      Accept: "application/xml",
    }, `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/></d:prop>
</d:propfind>`);

    const listXml = await listRes.text();
    const blocks = listXml.match(/<[A-Za-z0-9]*:?response[\s\S]*?<\/[A-Za-z0-9]*:?response>/g) ?? [];
    const vtodoLists: { href: string; name: string }[] = [];
    for (const block of blocks) {
      if (!block.includes("VTODO")) continue;
      const href = block.match(/<[A-Za-z0-9]*:?href[^>]*>([^<]+)<\/[A-Za-z0-9]*:?href>/i)?.[1]?.trim() ?? "";
      const name = block.match(/<[A-Za-z0-9]*:?displayname[^>]*>([^<]*)<\/[A-Za-z0-9]*:?displayname>/i)?.[1]?.trim() ?? "";
      vtodoLists.push({ href, name });
    }

    // Check each VTODO list for "test" item
    const testSearch: { href: string; name: string; itemCount: number; hasTest: boolean }[] = [];
    for (const col of vtodoLists) {
      const url = col.href.startsWith("http") ? col.href : `${new URL(discovery.homeUrl).protocol}//${new URL(discovery.homeUrl).host}${col.href}`;
      const rptRes = await calFetchRaw(url.endsWith("/") ? url : url + "/", "REPORT", {
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

    results[base] = { ...discovery, vtodoLists, testSearch };
  }

  return NextResponse.json(results);
}
