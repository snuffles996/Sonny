// iCloud Reminders via CalDAV.
// Reminders are VTODO collections served from the same caldav.icloud.com home as
// VEVENT calendars — we reuse the proven discovery path instead of hitting
// reminders.icloud.com (separate discovery, fragile namespace parsing).

import { calFetch, authHeader, discoverHomeUrl } from "./client";
import { getPrefs } from "@/lib/mealplan/store";
import type { GroceryItem } from "@/lib/mealplan/grocery";
import type { UserId } from "@/lib/profile/types";

const CALDAV_BASE = "https://caldav.icloud.com";

// ── Helpers ──────────────────────────────────────────────────────────────────

// Namespace-agnostic element value extraction (same pattern as client.ts)
function extractText(xml: string, element: string): string | null {
  const re = new RegExp(`<[A-Za-z0-9]*:?${element}[^>]*>([^<]*)<\\/[A-Za-z0-9]*:?${element}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function extractHref(block: string): string | null {
  const m = block.match(/<[A-Za-z0-9]*:?href[^>]*>([^<]+)<\/[A-Za-z0-9]*:?href>/i);
  return m ? m[1].trim() : null;
}

function toAbsolute(href: string, base: string): string {
  if (href.startsWith("http")) return href;
  const u = new URL(base);
  return `${u.protocol}//${u.host}${href}`;
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : url + "/";
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

// ── List discovery ────────────────────────────────────────────────────────────

async function listReminderLists(): Promise<{ url: string; displayName: string }[]> {
  const homeUrl = await discoverHomeUrl();

  const res = await calFetch(homeUrl, "PROPFIND", {
    Depth: "1",
    "Content-Type": "application/xml; charset=utf-8",
    Accept: "application/xml",
  }, `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <c:supported-calendar-component-set/>
  </d:prop>
</d:propfind>`);

  if (res.status !== 207 && !res.ok) {
    throw new Error(`Reminder list discovery failed: ${res.status}`);
  }
  const text = await res.text();

  const blocks = text.match(/<[A-Za-z0-9]*:?response[\s\S]*?<\/[A-Za-z0-9]*:?response>/g) ?? [];
  const lists: { url: string; displayName: string }[] = [];

  for (const block of blocks) {
    // Only VTODO collections
    if (!block.includes("VTODO")) continue;
    const href = extractHref(block);
    if (!href) continue;
    const name = decodeEntities(
      block.match(/<[A-Za-z0-9]*:?displayname[^>]*>([^<]*)<\/[A-Za-z0-9]*:?displayname>/i)?.[1]?.trim() ?? ""
    );
    lists.push({
      url: ensureTrailingSlash(toAbsolute(href, homeUrl)),
      displayName: name,
    });
  }
  return lists;
}

export async function getOrCreateList(listName: string): Promise<string> {
  const lists = await listReminderLists();
  const existing = lists.find((l) => l.displayName.toLowerCase() === listName.toLowerCase());
  if (existing) return existing.url;

  // Create a new VTODO collection
  const homeUrl = await discoverHomeUrl();
  const slug = listName.toLowerCase().replace(/[^a-z0-9]/g, "-");
  const newUrl = ensureTrailingSlash(`${ensureTrailingSlash(homeUrl)}${slug}`);

  const mkcolXml = `<?xml version="1.0" encoding="UTF-8"?>
<d:mkcol xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:set>
    <d:prop>
      <d:displayname>${listName}</d:displayname>
      <c:supported-calendar-component-set>
        <c:comp name="VTODO"/>
      </c:supported-calendar-component-set>
    </d:prop>
  </d:set>
</d:mkcol>`;

  const mkRes = await calFetch(newUrl, "MKCOL", { "Content-Type": "application/xml; charset=utf-8" }, mkcolXml);
  if (!mkRes.ok && mkRes.status !== 405) {
    throw new Error(`Could not create Reminders list "${listName}": ${mkRes.status}`);
  }
  return newUrl;
}

export async function getExistingItems(listHref: string): Promise<{ uid: string; title: string }[]> {
  const url = ensureTrailingSlash(listHref);
  const res = await calFetch(url, "REPORT", {
    Depth: "1",
    "Content-Type": "application/xml; charset=utf-8",
    Accept: "application/xml",
  }, `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VTODO"/>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`);

  if (!res.ok && res.status !== 207) return [];
  const text = await res.text();

  const items: { uid: string; title: string }[] = [];
  const re = /<[A-Za-z0-9]*:?calendar-data[^>]*>([\s\S]*?)<\/[A-Za-z0-9]*:?calendar-data>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const uidMatch = m[1].match(/^UID:(.+)$/m);
    const summaryMatch = m[1].match(/^SUMMARY:(.+)$/m);
    if (uidMatch) {
      items.push({ uid: uidMatch[1].trim(), title: summaryMatch?.[1].trim() ?? "" });
    }
  }
  return items;
}

export async function clearList(listHref: string): Promise<void> {
  const items = await getExistingItems(listHref);
  await Promise.all(
    items.map((item) => {
      const url = `${ensureTrailingSlash(listHref)}${item.uid}.ics`;
      return calFetch(url, "DELETE", { Authorization: authHeader() }).catch(() => {});
    })
  );
}

export async function addReminder(listHref: string, title: string): Promise<void> {
  const uid = `${crypto.randomUUID()}@sonny`;
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";
  const ical = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sonny//Personal AI//EN",
    "BEGIN:VTODO",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `SUMMARY:${title}`,
    "STATUS:NEEDS-ACTION",
    "END:VTODO",
    "END:VCALENDAR",
  ].join("\r\n");

  const url = `${ensureTrailingSlash(listHref)}${uid}.ics`;
  const res = await calFetch(url, "PUT", {
    "Content-Type": "text/calendar; charset=utf-8",
    "If-None-Match": "*",
  }, ical);

  if (!res.ok) {
    throw new Error(`Failed to add reminder "${title}": ${res.status}`);
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface PushResult {
  added: number;
  listName: string;
  existingCount: number;
}

export async function pushGroceryList(
  items: GroceryItem[],
  _userId: UserId,
  mode: "replace" | "append" | "force_replace" = "replace",
  householdItems: string[] = []
): Promise<PushResult> {
  const prefs = await getPrefs();
  const listName = prefs.defaultRemindersListName;
  const listHref = await getOrCreateList(listName);

  const existing = await getExistingItems(listHref);

  if (mode === "replace" && existing.length > 0) {
    return { added: 0, listName, existingCount: existing.length };
  }

  if (mode === "force_replace" && existing.length > 0) {
    await clearList(listHref);
  }

  const titles = items.map((item) => `${item.name} — ${item.displayQty}`);
  if (householdItems.length > 0) {
    titles.push(...householdItems);
  }

  const CHUNK = 5;
  for (let i = 0; i < titles.length; i += CHUNK) {
    await Promise.all(titles.slice(i, i + CHUNK).map((t) => addReminder(listHref, t)));
  }
  return { added: titles.length, listName, existingCount: 0 };
}
