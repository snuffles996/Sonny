// POST — generate a new meal plan directly (used by PlanMealsModal UI)
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getRecipes } from "@/lib/recipes/store";
import { getProfile } from "@/lib/profile/store";
import { getActivePlan, saveActivePlan } from "@/lib/mealplan/store";
import { selectMeals } from "@/lib/mealplan/select";
import type { MealPlan, PlannedMeal } from "@/lib/mealplan/types";

export async function POST(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    count?: number;
    servings?: number;
    preferences?: string;
  };

  const count = Math.min(Math.max(body.count ?? 4, 1), 7);
  const servings = Math.min(Math.max(body.servings ?? 2, 1), 10);
  const preferences = body.preferences ?? "";

  const [allRecipes, activePlan, profile] = await Promise.all([
    getRecipes(),
    getActivePlan(),
    getProfile(userId),
  ]);

  const suggestions = await selectMeals({
    allRecipes,
    activePlan,
    profile,
    busyNights: [],
    count,
    preferences,
  });

  if (suggestions.length === 0) {
    return NextResponse.json(
      { error: "No matching recipes found. Try adjusting preferences or adding more recipes." },
      { status: 422 }
    );
  }

  const meals: PlannedMeal[] = suggestions.map((s) => ({
    recipeSlug: s.recipe.slug,
    recipeName: s.recipe.name,
    addedBy: userId,
    servings,
    made: false,
  }));

  const plan: MealPlan = {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: userId,
    meals,
    servings,
    groceryListSent: false,
  };

  await saveActivePlan(plan);
  return NextResponse.json({ plan });
}
