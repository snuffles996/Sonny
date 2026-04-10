// GET  /api/profile — return current user profile document
// PUT  /api/profile — update one or more fields (called by Claude intent handler)

import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  // TODO: load profile from Vercel KV (keyed by user id)
  return NextResponse.json({ message: "profile GET stub" }, { status: 200 });
}

export async function PUT(req: NextRequest) {
  // TODO: merge patch into stored profile document
  return NextResponse.json({ message: "profile PUT stub" }, { status: 200 });
}
