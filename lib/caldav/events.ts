import { getCalDAVClient } from "./client";

// Kevin: San Diego. Kylie shares the same timezone.
// If users diverge on timezone this should come from the profile.
export const USER_TIMEZONE = "America/Los_Angeles";

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
function localToUTC(localISO: string, tzid: string): Date {
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
    const date = new Date(`${iso}T12:00:00Z`);
    const label = new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getUpcomingEvents(days = 14): Promise<string> {
  const client = await getCalDAVClient();
  const calendars = await client.fetchCalendars();
  if (calendars.length === 0) return "No calendars found.";

  const now = new Date();
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const allObjects = await Promise.all(
    calendars.map((cal) =>
      client
        .fetchCalendarObjects({
          calendar: cal,
          timeRange: { start: now.toISOString(), end: end.toISOString() },
        })
        .catch(() => [])
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

  for (const objects of allObjects) {
    for (const obj of objects) {
      if (!obj.data) continue;
      const raw = unfold(typeof obj.data === "string" ? obj.data : String(obj.data));
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

  if (events.length === 0) return `No upcoming events in the next ${days} days.`;

  events.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  const lines = events.map((e) => {
    const loc = e.location ? ` @ ${e.location}` : "";
    return `• ${e.startLabel}${loc} — ${e.title}`;
  });

  return `Upcoming events (next ${days} days):\n${lines.join("\n")}`;
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
  const client = await getCalDAVClient();
  const calendars = await client.fetchCalendars();
  if (calendars.length === 0) throw new Error("No calendars available");

  // Prefer a calendar named Home, Personal, or Calendar; fall back to first
  const preferred =
    calendars.find((c) => {
      const name =
        typeof c.displayName === "string" ? c.displayName.toLowerCase() : "";
      return ["home", "personal", "calendar"].includes(name);
    }) ?? calendars[0];

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

  await client.createCalendarObject({
    calendar: preferred,
    iCalString: lines.join("\r\n"),
    filename: `${uid}.ics`,
  });
}
