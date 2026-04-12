// GET  — build and return grocery items for the active plan
// POST — push grocery items to iCloud Reminders

import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getActivePlan, saveActivePlan } from "@/lib/mealplan/store";
import { getRecipes } from "@/lib/recipes/store";
import { buildGroceryList } from "@/lib/mealplan/grocery";
import { pushGroceryList } from "@/lib/caldav/reminders";
import { getExclusions } from "@/lib/mealplan/pantry";
import { getHouseholdItems } from "@/lib/mealplan/household";

export async function GET(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await getActivePlan();
  if (!plan) return NextResponse.json({ error: "No active plan" }, { status: 404 });

  const [recipes, exclusions] = await Promise.all([getRecipes(), getExclusions()]);
  const items = await buildGroceryList(plan.meals, recipes, plan.servings, exclusions);
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { replace?: boolean; includeHousehold?: boolean };
  const mode = body.replace ? "force_replace" : "replace";

  const plan = await getActivePlan();
  if (!plan) return NextResponse.json({ error: "No active plan" }, { status: 404 });

  const [recipes, exclusions, householdItems] = await Promise.all([
    getRecipes(),
    getExclusions(),
    body.includeHousehold ? getHouseholdItems() : Promise.resolve([]),
  ]);

  try {
    const items = await buildGroceryList(plan.meals, recipes, plan.servings, exclusions);
    const result = await pushGroceryList(items, userId, mode, householdItems);

    if (result.existingCount > 0 && mode === "replace") {
      return NextResponse.json({ existingCount: result.existingCount, listName: result.listName, existingTitles: result.existingTitles });
    }

    plan.groceryListSent = true;
    await saveActivePlan(plan);

    return NextResponse.json({ added: result.added, listName: result.listName });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to push to Reminders";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
