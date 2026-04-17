// GET /api/calendar/upcoming — return upcoming calendar events
// Query params: ?days=7
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getUpcomingEvents } from "@/lib/caldav/events";
import { isCalDAVConfigured } from "@/lib/caldav/client";

export async function GET(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isCalDAVConfigured()) {
    return NextResponse.json({ error: "Calendar not configured" }, { status: 503 });
  }

  const days = Math.min(parseInt(req.nextUrl.searchParams.get("days") ?? "7", 10), 30);

  try {
    const events = await getUpcomingEvents(days);
    return NextResponse.json({ events });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
