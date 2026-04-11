// iCloud Reminders via CalDAV — same protocol as calendar but uses VTODO
// and points at reminders.icloud.com instead of caldav.icloud.com.
// CRITICAL: all requests use calFetch() to preserve auth headers across redirects.

import { calFetch, authHeader } from "./client";
import { getPrefs } from "@/lib/mealplan/store";
import type { GroceryItem } from "@/lib/mealplan/grocery";
import type { UserId } from "@/lib/profile/types";

const REMINDERS_BASE = "https://reminders.icloud.com";

// Cached reminders home URL (cleared each cold start)
let _remindersHomeUrl: string | null = null;

async function discoverRemindersHome(): Promise<string> {
  if (_remindersHomeUrl) return _remindersHomeUrl;

  // Step 1: Find current-user-principal
  const principalXml = `<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop><D:current-user-principal/></D:prop>
</D:propfind>`;

  const principalRes = await calFetch(
    REMINDERS_BASE,
    "PROPFIND",
    { Depth: "0", "Content-Type": "application/xml; charset=utf-8", Accept: "application/xml" },
    principalXml
  );
  const principalText = await principalRes.text();
  const principalMatch = principalText.match(/<D:href[^>]*>([^<]+)<\/D:href>/i);
  if (!principalMatch) throw new Error("Could not find reminders principal URL");
  const principalUrl = principalMatch[1].startsWith("http")
    ? principalMatch[1]
    : `${REMINDERS_BASE}${principalMatch[1]}`;

  // Step 2: Find addressbook-home-set (for reminders it's the calendar-home-set in VTODO collections)
  const homeXml = `<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><C:calendar-home-set/></D:prop>
</D:propfind>`;

  const homeRes = await calFetch(
    principalUrl,
    "PROPFIND",
    { Depth: "0", "Content-Type": "application/xml; charset=utf-8", Accept: "application/xml" },
    homeXml
  );
  const homeText = await homeRes.text();
  const homeMatch = homeText.match(/<C:calendar-home-set[^>]*>[\s\S]*?<D:href[^>]*>([^<]+)<\/D:href>/i)
    ?? homeText.match(/<calendar-home-set[^>]*>[\s\S]*?<href[^>]*>([^<]+)<\/href>/i);
  if (!homeMatch) throw new Error("Could not find reminders home URL");

  _remindersHomeUrl = homeMatch[1].startsWith("http")
    ? homeMatch[1]
    : `${REMINDERS_BASE}${homeMatch[1]}`;
  return _remindersHomeUrl;
}

async function listReminderLists(): Promise<{ url: string; displayName: string }[]> {
  const homeUrl = await discoverRemindersHome();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">
  <D:prop>
    <D:displayname/>
    <C:supported-calendar-component-set/>
  </D:prop>
</D:propfind>`;

  const res = await calFetch(
    homeUrl,
    "PROPFIND",
    { Depth: "1", "Content-Type": "application/xml; charset=utf-8", Accept: "application/xml" },
    xml
  );
  const text = await res.text();

  const lists: { url: string; displayName: string }[] = [];
  // Parse each <D:response> block
  const responseRe = /<D:response>([\s\S]*?)<\/D:response>/gi;
  let m: RegExpExecArray | null;
  while ((m = responseRe.exec(text)) !== null) {
    const block = m[1];
    // Only include collections that support VTODO
    if (!block.includes("VTODO")) continue;
    const hrefMatch = block.match(/<D:href[^>]*>([^<]+)<\/D:href>/i);
    const nameMatch = block.match(/<D:displayname[^>]*>([^<]*)<\/D:displayname>/i);
    if (!hrefMatch) continue;
    const url = hrefMatch[1].startsWith("http")
      ? hrefMatch[1]
      : `${REMINDERS_BASE}${hrefMatch[1]}`;
    lists.push({ url, displayName: nameMatch?.[1] ?? "Reminders" });
  }
  return lists;
}

export async function getOrCreateList(listName: string): Promise<string> {
  const lists = await listReminderLists();
  const existing = lists.find(
    (l) => l.displayName.toLowerCase() === listName.toLowerCase()
  );
  if (existing) return existing.url;

  // Create a new list with MKCOL
  const homeUrl = await discoverRemindersHome();
  const slug = listName.toLowerCase().replace(/[^a-z0-9]/g, "-");
  const newUrl = `${homeUrl}${slug}/`;

  const mkcolXml = `<?xml version="1.0" encoding="UTF-8"?>
<D:mkcol xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <D:displayname>${listName}</D:displayname>
      <C:supported-calendar-component-set>
        <C:comp name="VTODO"/>
      </C:supported-calendar-component-set>
    </D:prop>
  </D:set>
</D:mkcol>`;

  await calFetch(
    newUrl,
    "MKCOL",
    { "Content-Type": "application/xml; charset=utf-8" },
    mkcolXml
  );
  return newUrl;
}

export async function getExistingItems(listHref: string): Promise<{ uid: string; title: string }[]> {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VTODO"/>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

  const res = await calFetch(
    listHref,
    "REPORT",
    { Depth: "1", "Content-Type": "application/xml; charset=utf-8", Accept: "application/xml" },
    xml
  );
  const text = await res.text();

  const items: { uid: string; title: string }[] = [];
  const calDataRe = /<C:calendar-data[^>]*>([\s\S]*?)<\/C:calendar-data>/gi;
  let m: RegExpExecArray | null;
  while ((m = calDataRe.exec(text)) !== null) {
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
      const url = `${listHref}${item.uid}.ics`;
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

  const url = `${listHref}${uid}.ics`;
  await calFetch(url, "PUT", {
    "Content-Type": "text/calendar; charset=utf-8",
    "If-None-Match": "*",
  }, ical);
}

export interface PushResult {
  added: number;
  listName: string;
  existingCount: number; // > 0 means caller should confirm before clearing
}

// Orchestrate pushing a grocery list to iCloud Reminders.
// If the list already has items, returns existingCount > 0 so the caller
// can ask the user whether to replace or append.
export async function pushGroceryList(
  items: GroceryItem[],
  _userId: UserId,
  mode: "replace" | "append" | "force_replace" = "replace"
): Promise<PushResult> {
  const prefs = await getPrefs();
  const listName = prefs.defaultRemindersListName;
  const listHref = await getOrCreateList(listName);

  const existing = await getExistingItems(listHref);

  // "replace" mode: signal the caller to confirm if items already exist
  if (mode === "replace" && existing.length > 0) {
    return { added: 0, listName, existingCount: existing.length };
  }

  // "force_replace" mode: clear before adding
  if (mode === "force_replace" && existing.length > 0) {
    await clearList(listHref);
  }

  // Push items in parallel chunks of 5 to avoid sequential timeout
  const titles = items.map((item) => `${item.name} — ${item.displayQty}`);
  const CHUNK = 5;
  for (let i = 0; i < titles.length; i += CHUNK) {
    await Promise.all(titles.slice(i, i + CHUNK).map((t) => addReminder(listHref, t)));
  }
  return { added: titles.length, listName, existingCount: 0 };
}
