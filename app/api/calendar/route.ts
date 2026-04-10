// GET  /api/calendar — read upcoming events from iCloud CalDAV
// POST /api/calendar — write event (requires explicit confirmation flag)

import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  // TODO: connect to CalDAV (tsdav), fetch upcoming events for user
  return NextResponse.json({ message: "calendar GET stub" }, { status: 200 });
}

export async function POST(req: NextRequest) {
  // TODO: require { confirmed: true } in body before writing
  // TODO: create/update event via CalDAV
  return NextResponse.json({ message: "calendar POST stub" }, { status: 200 });
}
