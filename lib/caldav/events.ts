import { listCalendars, fetchCalendarIcals, putCalendarObject } from "./client";

// Kevin: San Diego. Kylie shares the same timezone.
// If users diverge on timezone this should come from the profile.
export const USER_TIMEZONE = "America/Los_Angeles";

// Calendars Sonny reads events from (comma-separated display names)
const READ_CALENDAR_NAMES = (process.env.CALDAV_READ_CALENDARS ?? "Kevin's Calendar,Runna")
  .split(",").map((s) => s.trim().toLowerCase());

// Calendar Sonny writes new events to
const WRITE_CALENDAR_NAME = (process.env.CALDAV_WRITE_CALENDAR ?? "Kevin's Calendar").toLowerCase();

// Direct ICS subscription URLs (for calendars like Runna that aren't native CalDAV collections).
// Format: "Name=https://..." comma-separated. Name is used only for display.
// e.g. ICS_SUBSCRIPTIONS="Runna=https://cal.runna.com/abc123.ics"
const ICS_SUBSCRIPTIONS: { name: string; url: string }[] = (
  process.env.ICS_SUBSCRIPTIONS ?? ""
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((entry) => {
    const eq = entry.indexOf("=");
    return eq > 0
      ? { name: entry.slice(0, eq).trim(), url: entry.slice(eq + 1).trim() }
      : { name: "Subscription", url: entry };
  });

// ---------------------------------------------------------------------------
// iCal parsing helpers
// ---------------------------------------------------------------------------

// Unfold RFC 5545 line continuations
function unfold(ical: string): string {
  return ical.replace(/\r?\n[ \t]/g, "");
}

// Extract all VEVENT blocks from a VCALENDAR string
function getVEvents(ical: string): string[] {
  const events: string[] = [];
  const re = /BEGIN:VEVENT[\s\S]*?END:VEVENT/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ical)) !== null) events.push(m[0]);
  return events;
}

interface PropResult {
  value: string;
  tzid?: string;
  valueType?: string;
}

// Parse a property like "DTSTART;TZID=America/Los_Angeles:20260415T100000"
function getProp(vevent: string, name: string): PropResult | null {
  const re = new RegExp(`^${name}(?:;([^:]+))?:(.+)$`, "m");
  const m = vevent.match(re);
  if (!m) return null;

  const params: Record<string, string> = {};
  if (m[1]) {
    for (const part of m[1].split(";")) {
      const eq = part.indexOf("=");
      if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
    }
  }
  return { value: m[2].trim(), tzid: params["TZID"], valueType: params["VALUE"] };
}

// Convert a local datetime string + timezone to a UTC Date using Intl
export function localToUTC(localISO: string, tzid: string): Date {
  const fakeUTC = new Date(localISO + "Z");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tzid,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(fakeUTC);

  const p: Record<string, string> = {};
  for (const { type, value } of parts) p[type] = value;

  const h = p.hour === "24" ? "00" : p.hour;
  const fakeLocalUTC = new Date(`${p.year}-${p.month}-${p.day}T${h}:${p.minute}:${p.second}Z`);
  const offsetMs = fakeLocalUTC.getTime() - fakeUTC.getTime();
  return new Date(fakeUTC.getTime() - offsetMs);
}

interface ParsedDate {
  date: Date;
  allDay: boolean;
  label: string;
}

function parseICalDate(prop: PropResult): ParsedDate {
  const v = prop.value;

  // All-day: VALUE=DATE or 8-char string YYYYMMDD
  if (prop.valueType === "DATE" || v.length === 8) {
    const iso = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
    // Use noon UTC — safely the same calendar date in any timezone (avoids midnight UTC
    // being interpreted as the previous day in negative-offset timezones like PDT)
    const date = new Date(`${iso}T12:00:00Z`);
    const label = date.toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric", timeZone: USER_TIMEZONE,
    });
    return { date, allDay: true, label };
  }

  // Datetime: YYYYMMDDTHHMMSS[Z]
  const iso = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(9, 11)}:${v.slice(11, 13)}:${v.slice(13, 15)}`;
  let date: Date;
  if (v.endsWith("Z")) {
    date = new Date(iso + "Z");
  } else {
    date = localToUTC(iso, prop.tzid ?? USER_TIMEZONE);
  }

  const label = date.toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: USER_TIMEZONE,
  });
  return { date, allDay: false, label };
}

// Fetch a full ICS subscription URL and return VEVENT blocks that overlap [start, end]
async function fetchSubscriptionIcals(url: string, start: Date, end: Date): Promise<string[]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const text = await res.text();
    const raw = unfold(text);
    const vevents = getVEvents(raw);

    // Filter to events whose DTSTART falls within [start, end)
    return vevents.filter((ve) => {
      const dtstart = getProp(ve, "DTSTART");
      if (!dtstart) return false;
      try {
        const { date } = parseICalDate(dtstart);
        return date >= start && date < end;
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getUpcomingEvents(
  options?: number | { from: Date; to: Date }
): Promise<string> {
  const now = new Date();
  let startOfToday: Date;
  let end: Date;
  let days: number;

  if (options && typeof options === "object") {
    // Explicit date range
    startOfToday = options.from;
    end = options.to;
    days = Math.ceil((end.getTime() - startOfToday.getTime()) / 86400000);
  } else {
    // Default: N days forward from midnight today
    days = typeof options === "number" ? options : 14;
    // Start from midnight of today in the user's timezone, not the current UTC instant.
    // Without this, at e.g. 9 PM PDT (= 4 AM UTC next day) the query skips today entirely.
    const todayDateStr = now.toLocaleDateString("en-CA", { timeZone: USER_TIMEZONE }); // "YYYY-MM-DD"
    startOfToday = localToUTC(`${todayDateStr}T00:00:00`, USER_TIMEZONE);
    end = new Date(startOfToday.getTime() + days * 24 * 60 * 60 * 1000);
  }

  // CalDAV calendars + direct ICS subscriptions in parallel
  const [calendars, ...subscriptionEventGroups] = await Promise.all([
    listCalendars().catch(() => [] as Awaited<ReturnType<typeof listCalendars>>),
    ...ICS_SUBSCRIPTIONS.map((sub) => fetchSubscriptionIcals(sub.url, startOfToday, end)),
  ]);

  const readCalendars = calendars.filter((c) =>
    READ_CALENDAR_NAMES.includes(c.displayName.toLowerCase())
  );

  const allIcals = await Promise.all(
    readCalendars.map((cal) => fetchCalendarIcals(cal.url, startOfToday, end).catch(() => []))
  );

  // Each subscription returns pre-filtered VEVENT strings; wrap them as synthetic ICS so
  // the same parsing loop handles them without duplication.
  const subscriptionIcals: string[][] = subscriptionEventGroups.map((vevents) =>
    vevents.map(
      (ve) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${ve}\r\nEND:VCALENDAR`
    )
  );

  interface Event {
    uid: string;
    title: string;
    startDate: Date;
    startLabel: string;
    allDay: boolean;
    location?: string;
  }

  const seen = new Set<string>();
  const events: Event[] = [];

  for (const icals of [...allIcals, ...subscriptionIcals]) {
    for (const ical of icals) {
      const raw = unfold(ical);
      for (const vevent of getVEvents(raw)) {
        const status = getProp(vevent, "STATUS");
        if (status?.value === "CANCELLED") continue;

        const summary = getProp(vevent, "SUMMARY");
        const dtstart = getProp(vevent, "DTSTART");
        const uid = getProp(vevent, "UID");
        const location = getProp(vevent, "LOCATION");
        if (!summary || !dtstart) continue;

        const uidVal = uid?.value ?? `${summary.value}-${dtstart.value}`;
        if (seen.has(uidVal)) continue;
        seen.add(uidVal);

        const startParsed = parseICalDate(dtstart);
        events.push({
          uid: uidVal,
          title: summary.value.replace(/\\,/g, ",").replace(/\\n/g, " "),
          startDate: startParsed.date,
          startLabel: startParsed.label,
          allDay: startParsed.allDay,
          location: location?.value?.replace(/\\,/g, ","),
        });
      }
    }
  }

  const todayLabel = now.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
    timeZone: USER_TIMEZONE,
  });

  if (events.length === 0) return `Today is ${todayLabel}.\nNo upcoming events in the next ${days} days.`;

  events.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  const lines = events.map((e) => {
    const loc = e.location ? ` @ ${e.location}` : "";
    return `• ${e.startLabel}${loc} — ${e.title}`;
  });

  return `Today is ${todayLabel}.\nUpcoming events (next ${days} days):\n${lines.join("\n")}`;
}

export interface NewEventDetails {
  title: string;
  startLocal: string; // "YYYYMMDDTHHMMSS" or "YYYYMMDD" for all-day
  endLocal: string;
  allDay: boolean;
  timezone: string;
  location?: string;
  notes?: string;
}

export async function createEvent(details: NewEventDetails): Promise<void> {
  const calendars = await listCalendars();
  if (calendars.length === 0) throw new Error("No calendars available");

  // Write to the configured calendar name, fall back to first available
  const preferred =
    calendars.find((c) => c.displayName.toLowerCase() === WRITE_CALENDAR_NAME) ??
    calendars[0];

  const uid = `${crypto.randomUUID()}@sonny`;
  const stamp =
    new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";

  const dtstart = details.allDay
    ? `DTSTART;VALUE=DATE:${details.startLocal.slice(0, 8)}`
    : `DTSTART;TZID=${details.timezone}:${details.startLocal}`;
  const dtend = details.allDay
    ? `DTEND;VALUE=DATE:${details.endLocal.slice(0, 8)}`
    : `DTEND;TZID=${details.timezone}:${details.endLocal}`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sonny//Personal AI//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    dtstart,
    dtend,
    `SUMMARY:${details.title}`,
  ];
  if (details.location) lines.push(`LOCATION:${details.location}`);
  if (details.notes) lines.push(`DESCRIPTION:${details.notes}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  await putCalendarObject(preferred.url, uid, lines.join("\r\n"));
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

export interface EventDraft {
  title: string;
  startLocal: string; // "YYYYMMDDTHHMMSS"
  endLocal: string;
  allDay: boolean;
  timezone: string;
  location?: string;
  notes?: string;
}

export interface DedupeResult {
  toCreate: EventDraft[];
  toSkip: EventDraft[];
}

// Check a list of draft events against existing CalDAV events in a date range.
// Matches on title (case-insensitive) + date (YYYYMMDD of startLocal).
export async function checkDuplicates(
  drafts: EventDraft[],
  from: Date,
  to: Date
): Promise<DedupeResult> {
  let existingKeys: Set<string>;
  try {
    const calendars = await listCalendars();
    const writeCalendar =
      calendars.find((c) => c.displayName.toLowerCase() === WRITE_CALENDAR_NAME) ??
      calendars[0];
    if (!writeCalendar) return { toCreate: drafts, toSkip: [] };

    const icals = await fetchCalendarIcals(writeCalendar.url, from, to);
    existingKeys = new Set<string>();
    for (const ical of icals) {
      const raw = unfold(ical);
      for (const vevent of getVEvents(raw)) {
        const summary = getProp(vevent, "SUMMARY");
        const dtstart = getProp(vevent, "DTSTART");
        if (!summary || !dtstart) continue;
        const title = summary.value.replace(/\\,/g, ",").trim().toLowerCase();
        const dateStamp = dtstart.value.slice(0, 8); // YYYYMMDD
        existingKeys.add(`${title}|${dateStamp}`);
      }
    }
  } catch {
    // If we can't fetch existing events, create all drafts
    return { toCreate: drafts, toSkip: [] };
  }

  const toCreate: EventDraft[] = [];
  const toSkip: EventDraft[] = [];
  for (const draft of drafts) {
    const key = `${draft.title.trim().toLowerCase()}|${draft.startLocal.slice(0, 8)}`;
    if (existingKeys.has(key)) {
      toSkip.push(draft);
    } else {
      toCreate.push(draft);
    }
  }
  return { toCreate, toSkip };
}
