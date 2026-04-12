// GET   — return grocery list (builds and caches if needed)
// PATCH — toggle a checked item
// DELETE — clear the cached list (triggers rebuild on next GET)

import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getActivePlan } from "@/lib/mealplan/store";
import { getGroceryList, saveGroceryList, toggleGroceryItem, clearGroceryList } from "@/lib/mealplan/store";
import { getRecipes } from "@/lib/recipes/store";
import { buildGroceryList } from "@/lib/mealplan/grocery";
import { getCombinedExclusions } from "@/lib/mealplan/pantry";

export async function GET(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await getActivePlan();
  if (!plan) return NextResponse.json({ error: "No active plan" }, { status: 404 });

  // Return cached list if available
  const cached = await getGroceryList();
  if (cached) return NextResponse.json({ items: cached.items, checkedItems: cached.checkedItems });

  // Build and cache
  const [recipes, exclusions] = await Promise.all([getRecipes(), getCombinedExclusions()]);
  const items = await buildGroceryList(plan.meals, recipes, plan.servings, exclusions);
  await saveGroceryList(items);
  return NextResponse.json({ items, checkedItems: [] });
}

export async function PATCH(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as { itemName?: string } | null;
  if (!body?.itemName) return NextResponse.json({ error: "itemName required" }, { status: 400 });

  const checkedItems = await toggleGroceryItem(body.itemName);
  return NextResponse.json({ checkedItems });
}

export async function DELETE(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await clearGroceryList();
  return NextResponse.json({ ok: true });
}
