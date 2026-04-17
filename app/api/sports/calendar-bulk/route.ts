// POST /api/sports/calendar-bulk — add a team's full schedule to iCloud calendar
// Body: { team: string; homeOnly?: boolean; awayOnly?: boolean }
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { detectTeam, getBulkSchedule, addHours } from "@/lib/sports/lookup";
import { createEvent, checkDuplicates, USER_TIMEZONE, type EventDraft } from "@/lib/caldav/events";
import { isCalDAVConfigured } from "@/lib/caldav/client";

export async function POST(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isCalDAVConfigured()) {
    return NextResponse.json({ error: "Calendar not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => null) as {
    team?: string;
    homeOnly?: boolean;
    awayOnly?: boolean;
  } | null;

  if (!body?.team) return NextResponse.json({ error: "team required" }, { status: 400 });

  const team = detectTeam(body.team);
  if (!team) return NextResponse.json({ error: `Team not recognized: ${body.team}` }, { status: 404 });

  const fullSchedule = await getBulkSchedule(team);
  if (fullSchedule.length === 0) {
    return NextResponse.json({ error: `No schedule found for ${team.fullName}` }, { status: 404 });
  }

  let filtered = fullSchedule;
  if (body.homeOnly) filtered = fullSchedule.filter((g) => g.homeAway === "home");
  else if (body.awayOnly) filtered = fullSchedule.filter((g) => g.homeAway === "away");

  const drafts: EventDraft[] = filtered.map((g) => ({
    title: g.homeAway === "home"
      ? `${team.fullName} vs ${g.opponent}`
      : `${team.fullName} @ ${g.opponent}`,
    startLocal: g.startLocal,
    endLocal: addHours(g.startLocal, team.gameDurationHours),
    allDay: false,
    timezone: USER_TIMEZONE,
    location: g.venue,
  }));

  const dates = filtered.map((g) => new Date(g.date).getTime()).filter((t) => !isNaN(t));
  const rangeFrom = new Date(Math.min(...dates));
  const rangeTo = new Date(Math.max(...dates) + 86400000);
  const { toCreate, toSkip } = await checkDuplicates(drafts, rangeFrom, rangeTo);

  const CONCURRENCY = 5;
  let created = 0;
  let failed = 0;
  for (let i = 0; i < toCreate.length; i += CONCURRENCY) {
    const results = await Promise.allSettled(toCreate.slice(i, i + CONCURRENCY).map((d) => createEvent(d)));
    for (const r of results) r.status === "fulfilled" ? created++ : failed++;
  }

  return NextResponse.json({
    team: team.fullName,
    created,
    skipped: toSkip.length,
    failed,
  });
}
