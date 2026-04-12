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

// iCloud appends ⚠️ to shared list displayNames in CalDAV responses.
// Strip it so name lookups work regardless of sharing state.
function normalizeListName(name: string): string {
  return name.replace(/[\u26A0\uFE0F\s]+$/, "").trim();
}

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
    const rawName = decodeEntities(
      block.match(/<[A-Za-z0-9]*:?displayname[^>]*>([^<]*)<\/[A-Za-z0-9]*:?displayname>/i)?.[1]?.trim() ?? ""
    );
    lists.push({
      url: ensureTrailingSlash(toAbsolute(href, homeUrl)),
      displayName: normalizeListName(rawName),
    });
  }
  return lists;
}

export async function getOrCreateList(listName: string): Promise<string> {
  const lists = await listReminderLists();

  // Exact name match
  const exact = lists.find((l) => l.displayName.toLowerCase() === listName.toLowerCase());
  if (exact) return exact.url;

  // Try MKCALENDAR (correct CalDAV method for creating calendar collections).
  // iCloud often blocks this with 403 — we handle that gracefully below.
  const homeUrl = await discoverHomeUrl();
  const slug = listName.toLowerCase().replace(/[^a-z0-9]/g, "-");
  const newUrl = ensureTrailingSlash(`${ensureTrailingSlash(homeUrl)}${slug}`);

  const mkXml = `<?xml version="1.0" encoding="UTF-8"?>
<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:set>
    <d:prop>
      <d:displayname>${listName}</d:displayname>
      <c:supported-calendar-component-set>
        <c:comp name="VTODO"/>
      </c:supported-calendar-component-set>
    </d:prop>
  </d:set>
</c:mkcalendar>`;

  const mkRes = await calFetch(newUrl, "MKCALENDAR", { "Content-Type": "application/xml; charset=utf-8" }, mkXml);

  if (mkRes.ok || mkRes.status === 405 /* already exists */) {
    return newUrl;
  }

  // iCloud blocks Reminders list creation via CalDAV (returns 403).
  // Fall back to the first available Reminders list so the push still works,
  // or tell the user to create the list manually if none exist at all.
  if (lists.length > 0) {
    console.warn(`[reminders] Could not create list "${listName}" (${mkRes.status}), falling back to "${lists[0].displayName}"`);
    return lists[0].url;
  }

  throw new Error(
    `Could not create a Reminders list and no existing lists were found. ` +
    `Open the Reminders app and create a list called "${listName}", then try again.`
  );
}

export async function getExistingItems(listHref: string): Promise<{ href: string; uid: string; title: string }[]> {
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

  // Parse response blocks so we capture the actual server-side href (which may have %40 etc.)
  const responseBlocks = text.match(/<[A-Za-z0-9]*:?response[\s\S]*?<\/[A-Za-z0-9]*:?response>/g) ?? [];
  const items: { href: string; uid: string; title: string }[] = [];

  for (const block of responseBlocks) {
    const calDataM = block.match(/<[A-Za-z0-9]*:?calendar-data[^>]*>([\s\S]*?)<\/[A-Za-z0-9]*:?calendar-data>/i);
    if (!calDataM) continue;
    const calData = calDataM[1];
    const statusMatch = calData.match(/^STATUS:(.+)$/m);
    // Skip completed reminders — iCloud keeps them in the store but they're not visible
    if (statusMatch?.[1].trim().toUpperCase() === "COMPLETED") continue;
    const uidMatch = calData.match(/^UID:(.+)$/m);
    if (!uidMatch) continue;
    const hrefM = block.match(/<[A-Za-z0-9]*:?href[^>]*>([^<]+)<\/[A-Za-z0-9]*:?href>/i);
    const title = calData.match(/^SUMMARY:(.+)$/m)?.[1]?.trim() ?? "";
    items.push({
      href: hrefM?.[1]?.trim() ?? "",
      uid: uidMatch[1].trim(),
      title,
    });
  }
  return items;
}

export async function clearList(listHref: string): Promise<void> {
  const items = await getExistingItems(listHref);
  const base = ensureTrailingSlash(listHref);
  await Promise.all(
    items.map((item) => {
      // Use the server-provided href (preserves %40 etc.) — not reconstructed from UID
      const deleteUrl = item.href ? toAbsolute(item.href, base) : `${base}${item.uid}.ics`;
      return calFetch(deleteUrl, "DELETE", { Authorization: authHeader() }).catch(() => {});
    })
  );
}

export async function addReminder(listHref: string, title: string): Promise<void> {
  const uid = crypto.randomUUID();
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";
  // Escape special chars per RFC 5545 TEXT rules
  const escapedTitle = title.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,");

  // RFC 5545 §3.4: iCal object MUST end with END:VCALENDAR followed by CRLF
  const ical = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "PRODID:-//Sonny//Personal AI//EN",
    "BEGIN:VTODO",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `SUMMARY:${escapedTitle}`,
    "STATUS:NEEDS-ACTION",
    "END:VTODO",
    "END:VCALENDAR",
  ].join("\r\n") + "\r\n";

  const url = `${ensureTrailingSlash(listHref)}${uid}.ics`;
  const res = await calFetch(url, "PUT", {
    "Content-Type": "text/calendar; charset=utf-8",
  }, ical);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Failed to add reminder "${title}": ${res.status} — ${body.slice(0, 300)}`);
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface PushResult {
  added: number;
  listName: string;
  existingCount: number;
  existingTitles?: string[];
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
    return { added: 0, listName, existingCount: existing.length, existingTitles: existing.map((i) => i.title) };
  }

  if (mode === "force_replace" && existing.length > 0) {
    await clearList(listHref);
  }

  // Use ASCII colon separator — iCloud CalDAV 500s on multi-byte chars like em-dash in SUMMARY
  const titles = items.map((item) => `${item.name}: ${item.displayQty}`);
  if (householdItems.length > 0) {
    titles.push(...householdItems);
  }

  // iCloud CalDAV rate-limits concurrent VTODO writes — send sequentially
  for (const title of titles) {
    await addReminder(listHref, title);
  }
  return { added: titles.length, listName, existingCount: 0 };
}
