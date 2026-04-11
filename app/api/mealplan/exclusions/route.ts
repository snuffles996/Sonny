import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getExclusions, addExclusion, removeExclusion } from "@/lib/mealplan/pantry";

export async function GET(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const exclusions = await getExclusions();
  return NextResponse.json({ exclusions });
}

export async function POST(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { name?: string };
  if (!body.name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  const exclusions = await addExclusion(body.name);
  return NextResponse.json({ exclusions });
}

export async function DELETE(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { name?: string };
  if (!body.name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  const exclusions = await removeExclusion(body.name);
  return NextResponse.json({ exclusions });
}
