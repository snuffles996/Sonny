// Natural language date-range parser for calendar queries.
// All ranges are anchored to midnight USER_TIMEZONE.
// No LLM call — deterministic pattern matching.

import { USER_TIMEZONE, localToUTC } from "@/lib/caldav/events";

export interface DateRange {
  from: Date;
  to: Date;
  label: string; // human-readable description, e.g. "this week"
}

function startOfDayLocal(date: Date): Date {
  const dateStr = date.toLocaleDateString("en-CA", { timeZone: USER_TIMEZONE }); // "YYYY-MM-DD"
  return localToUTC(`${dateStr}T00:00:00`, USER_TIMEZONE);
}

function endOfDayLocal(date: Date): Date {
  const dateStr = date.toLocaleDateString("en-CA", { timeZone: USER_TIMEZONE });
  return localToUTC(`${dateStr}T23:59:59`, USER_TIMEZONE);
}

// Return the Monday of the week containing `date` (in USER_TIMEZONE)
function mondayOf(date: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: USER_TIMEZONE,
    weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const p: Record<string, string> = {};
  for (const { type, value } of parts) p[type] = value;
  const dayName = p.weekday; // "Mon", "Tue", etc.
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayIndex = days.indexOf(dayName);
  const daysToMonday = dayIndex === 0 ? -6 : 1 - dayIndex; // Sunday = go back 6
  return new Date(date.getTime() + daysToMonday * 86400000);
}

export function parseDateRange(message: string): DateRange | null {
  const lower = message.toLowerCase();
  const now = new Date();

  // "this week" → Mon–Sun of current week
  if (/\bthis week\b/.test(lower)) {
    const monday = mondayOf(now);
    const sunday = new Date(monday.getTime() + 6 * 86400000);
    return {
      from: startOfDayLocal(monday),
      to: endOfDayLocal(sunday),
      label: "this week",
    };
  }

  // "next week" → following Mon–Sun
  if (/\bnext week\b/.test(lower)) {
    const monday = new Date(mondayOf(now).getTime() + 7 * 86400000);
    const sunday = new Date(monday.getTime() + 6 * 86400000);
    return {
      from: startOfDayLocal(monday),
      to: endOfDayLocal(sunday),
      label: "next week",
    };
  }

  // "this weekend" → Sat–Sun of current week
  if (/\bthis weekend\b/.test(lower)) {
    const monday = mondayOf(now);
    const saturday = new Date(monday.getTime() + 5 * 86400000);
    const sunday = new Date(monday.getTime() + 6 * 86400000);
    return {
      from: startOfDayLocal(saturday),
      to: endOfDayLocal(sunday),
      label: "this weekend",
    };
  }

  // "next N days" / "next 3 days"
  const nextNDays = lower.match(/\bnext (\d+) days?\b/);
  if (nextNDays) {
    const n = parseInt(nextNDays[1], 10);
    const end = new Date(now.getTime() + n * 86400000);
    return {
      from: startOfDayLocal(now),
      to: endOfDayLocal(end),
      label: `next ${n} days`,
    };
  }

  // "rest of the month"
  if (/\brest of (the )?month\b/.test(lower)) {
    const localDateStr = now.toLocaleDateString("en-CA", { timeZone: USER_TIMEZONE });
    const [year, month] = localDateStr.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)); // last day of month
    return {
      from: startOfDayLocal(now),
      to: endOfDayLocal(lastDay),
      label: "rest of the month",
    };
  }

  // "next month"
  if (/\bnext month\b/.test(lower)) {
    const localDateStr = now.toLocaleDateString("en-CA", { timeZone: USER_TIMEZONE });
    const [year, month] = localDateStr.split("-").map(Number);
    const firstOfNext = new Date(Date.UTC(year, month, 1));   // first day of next month
    const lastOfNext = new Date(Date.UTC(year, month + 1, 0)); // last day of next month
    return {
      from: startOfDayLocal(firstOfNext),
      to: endOfDayLocal(lastOfNext),
      label: "next month",
    };
  }

  return null;
}
