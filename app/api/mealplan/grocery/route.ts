// GET  — build and return grocery items for the active plan
// POST — push grocery items to iCloud Reminders

import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getActivePlan, saveActivePlan } from "@/lib/mealplan/store";
import { getRecipes } from "@/lib/recipes/store";
import { buildGroceryList } from "@/lib/mealplan/grocery";
import { pushGroceryList } from "@/lib/caldav/reminders";

export async function GET(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await getActivePlan();
  if (!plan) return NextResponse.json({ error: "No active plan" }, { status: 404 });

  const recipes = await getRecipes();
  const items = await buildGroceryList(plan.meals, recipes, plan.servings);
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { replace?: boolean };
  const mode = body.replace ? "force_replace" : "replace";

  const plan = await getActivePlan();
  if (!plan) return NextResponse.json({ error: "No active plan" }, { status: 404 });

  const recipes = await getRecipes();
  const items = await buildGroceryList(plan.meals, recipes, plan.servings);
  const result = await pushGroceryList(items, userId, mode);

  if (result.existingCount > 0 && mode === "replace") {
    return NextResponse.json({ existingCount: result.existingCount, listName: result.listName });
  }

  // Mark plan as sent
  plan.groceryListSent = true;
  await saveActivePlan(plan);

  return NextResponse.json({ added: result.added, listName: result.listName });
}
