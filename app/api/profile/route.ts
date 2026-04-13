import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getProfile, saveProfile } from "@/lib/profile/store";

export async function GET(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const profile = await getProfile(userId);
  return NextResponse.json(profile);
}

export async function PATCH(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const updated = await saveProfile(userId, body);
  return NextResponse.json(updated);
}

// Keep PUT for backwards-compat with existing Claude intent handler calls
export async function PUT(req: NextRequest) {
  return PATCH(req);
}
