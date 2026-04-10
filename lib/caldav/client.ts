// Direct HTTP CalDAV client — replaces tsdav which fails on iCloud's homeUrl discovery.

const CALDAV_BASE = "https://caldav.icloud.com";

function authHeader(): string {
  // trim() guards against accidental whitespace in env var values
  const user = (process.env.CALDAV_USERNAME ?? "").trim();
  const pass = (process.env.CALDAV_PASSWORD ?? "").trim();
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

// fetch() strips Authorization on cross-origin redirects (e.g. caldav.icloud.com →
// p12-caldav.icloud.com), causing a 401. Follow redirects manually to re-attach auth.
async function calFetch(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string
): Promise<Response> {
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
      if (!loc) throw new Error(`Redirect with no Location header from ${current}`);
      current = loc.startsWith("http") ? loc : new URL(loc, current).href;
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}

async function propfind(url: string, body: string, depth = "0"): Promise<string> {
  const res = await calFetch(url, "PROPFIND", {
    Depth: depth,
    "Content-Type": "application/xml; charset=utf-8",
    Accept: "application/xml",
  }, body);
  // 207 Multi-Status is the expected success code for PROPFIND
  if (res.status !== 207 && !res.ok) {
    throw new Error(`PROPFIND ${url} → ${res.status}`);
  }
  return res.text();
}

function firstHref(xml: string): string | null {
  const m = xml.match(/<[A-Za-z0-9]*:?href[^>]*>([^<]+)<\/[A-Za-z0-9]*:?href>/);
  return m ? m[1].trim() : null;
}

function toAbsolute(href: string, base: string): string {
  if (href.startsWith("http")) return href;
  const u = new URL(base);
  return `${u.protocol}//${u.host}${href}`;
}

// ---------------------------------------------------------------------------
// Discovery — cached per cold start
// ---------------------------------------------------------------------------
let _homeUrl: string | null = null;

async function discoverHomeUrl(): Promise<string> {
  if (_homeUrl) return _homeUrl;

  // Step 1: current-user-principal from server root
  const xml1 = await propfind(
    CALDAV_BASE,
    `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:current-user-principal/></d:prop>
</d:propfind>`
  );

  const principalHref = firstHref(xml1);
  if (!principalHref) throw new Error("CalDAV: could not discover principal URL");
  const principalUrl = toAbsolute(principalHref, CALDAV_BASE);

  // Step 2: calendar-home-set from principal
  const xml2 = await propfind(
    principalUrl,
    `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-home-set/></d:prop>
</d:propfind>`
  );

  const homeHref = firstHref(xml2);
  if (!homeHref) throw new Error("CalDAV: could not discover calendar home URL");
  _homeUrl = toAbsolute(homeHref, principalUrl);
  return _homeUrl;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DAVCalendar {
  url: string;
  displayName: string;
}

export async function listCalendars(): Promise<DAVCalendar[]> {
  const homeUrl = await discoverHomeUrl();

  const xml = await propfind(
    homeUrl,
    `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
    <c:supported-calendar-component-set/>
  </d:prop>
</d:propfind>`,
    "1"
  );

  const calendars: DAVCalendar[] = [];
  const blocks = xml.match(/<[A-Za-z0-9]*:?response[\s\S]*?<\/[A-Za-z0-9]*:?response>/g) ?? [];

  for (const block of blocks) {
    if (!block.includes("calendar")) continue;
    if (!block.includes("VEVENT")) continue;

    const href = block.match(/<[A-Za-z0-9]*:?href[^>]*>([^<]+)<\/[A-Za-z0-9]*:?href>/)?.[1]?.trim();
    const name = block.match(/<[A-Za-z0-9]*:?displayname[^>]*>([^<]*)<\/[A-Za-z0-9]*:?displayname>/)?.[1]?.trim() ?? "";

    if (href) calendars.push({ url: toAbsolute(href, homeUrl), displayName: name });
  }

  return calendars;
}

export async function fetchCalendarIcals(
  calendarUrl: string,
  start: Date,
  end: Date
): Promise<string[]> {
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  const res = await calFetch(calendarUrl, "REPORT", {
    Depth: "1",
    "Content-Type": "application/xml; charset=utf-8",
    Accept: "application/xml",
  }, `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${fmt(start)}" end="${fmt(end)}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`);

  if (res.status !== 207 && !res.ok) return [];
  const xml = await res.text();

  const icals: string[] = [];
  const re = /<[A-Za-z0-9]*:?calendar-data[^>]*>([\s\S]*?)<\/[A-Za-z0-9]*:?calendar-data>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const data = m[1].trim();
    if (data) icals.push(data);
  }
  return icals;
}

export async function putCalendarObject(
  calendarUrl: string,
  uid: string,
  icalString: string
): Promise<void> {
  const res = await calFetch(
    `${calendarUrl.replace(/\/$/, "")}/${uid}.ics`,
    "PUT",
    { "Content-Type": "text/calendar; charset=utf-8", "If-None-Match": "*" },
    icalString
  );
  if (!res.ok) throw new Error(`CalDAV PUT failed: ${res.status}`);
}

export function isCalDAVConfigured(): boolean {
  return !!(process.env.CALDAV_USERNAME && process.env.CALDAV_PASSWORD);
}
