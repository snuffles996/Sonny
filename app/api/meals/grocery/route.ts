// GET /api/meals/grocery — return grocery list (builds and caches if needed)
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getActivePlan, getGroceryList, saveGroceryList } from "@/lib/mealplan/store";
import { getRecipes } from "@/lib/recipes/store";
import { buildGroceryList } from "@/lib/mealplan/grocery";
import { getCombinedExclusions } from "@/lib/mealplan/pantry";

export async function GET(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await getActivePlan();
  if (!plan) return NextResponse.json({ error: "No active plan" }, { status: 404 });

  const cached = await getGroceryList();
  if (cached) return NextResponse.json({ items: cached.items, checkedItems: cached.checkedItems });

  const [recipes, exclusions] = await Promise.all([getRecipes(), getCombinedExclusions()]);
  const items = await buildGroceryList(plan.meals, recipes, plan.servings, exclusions);
  await saveGroceryList(items);
  return NextResponse.json({ items, checkedItems: [] });
}
