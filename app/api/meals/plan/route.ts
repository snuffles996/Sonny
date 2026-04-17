// GET    /api/meals/plan — return active meal plan
// DELETE /api/meals/plan — clear active plan and grocery list
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getActivePlan, clearActivePlan } from "@/lib/mealplan/store";

export async function GET(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await getActivePlan();
  if (!plan) return NextResponse.json({ error: "No active plan" }, { status: 404 });

  return NextResponse.json({ plan });
}

export async function DELETE(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await getActivePlan();
  if (!plan) return NextResponse.json({ error: "No active plan" }, { status: 404 });

  await clearActivePlan(userId);
  return NextResponse.json({ cleared: true });
}
