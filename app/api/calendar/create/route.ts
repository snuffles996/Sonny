// POST /api/calendar/create — create a calendar event
// Body: EventDraft fields (title, startLocal, endLocal, allDay, timezone, location?, notes?)
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { createEvent, USER_TIMEZONE, type EventDraft } from "@/lib/caldav/events";
import { isCalDAVConfigured } from "@/lib/caldav/client";

export async function POST(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isCalDAVConfigured()) {
    return NextResponse.json({ error: "Calendar not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => null) as Partial<EventDraft> | null;
  if (!body?.title || !body?.startLocal || !body?.endLocal) {
    return NextResponse.json({ error: "title, startLocal, and endLocal are required" }, { status: 400 });
  }

  const draft: EventDraft = {
    title: body.title,
    startLocal: body.startLocal,
    endLocal: body.endLocal,
    allDay: body.allDay ?? false,
    timezone: body.timezone ?? USER_TIMEZONE,
    location: body.location,
    notes: body.notes,
  };

  try {
    await createEvent(draft);
    return NextResponse.json({ created: true, event: draft });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
