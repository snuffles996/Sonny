// POST /api/meals/create — run meal selection and save a new active plan
// Body (optional): { count?: number; preferences?: string }
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getProfile } from "@/lib/profile/store";
import { getRecipes } from "@/lib/recipes/store";
import { getActivePlan, saveActivePlan, clearGroceryList } from "@/lib/mealplan/store";
import { selectMeals } from "@/lib/mealplan/select";
import type { MealPlan, PlannedMeal } from "@/lib/mealplan/types";

export async function POST(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { count?: number; preferences?: string };
  const count = Math.min(body.count ?? 4, 7);

  const [recipes, activePlan, profile] = await Promise.all([
    getRecipes(),
    getActivePlan(),
    getProfile(userId),
  ]);

  const suggestions = await selectMeals({
    allRecipes: recipes,
    activePlan,
    profile,
    busyNights: [],
    count,
    preferences: body.preferences,
  });

  if (suggestions.length === 0) {
    return NextResponse.json({ error: "No recipes match current preferences" }, { status: 422 });
  }

  const planMeals: PlannedMeal[] = suggestions.map((s) => ({
    recipeSlug: s.recipe.slug,
    recipeName: s.recipe.name,
    addedBy: userId,
    made: false,
  }));

  const defaultServings = parseInt(process.env.DEFAULT_SERVINGS ?? "2", 10);
  const newPlan: MealPlan = {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: userId,
    meals: planMeals,
    servings: defaultServings,
  };

  await saveActivePlan(newPlan);
  await clearGroceryList();

  return NextResponse.json({ plan: newPlan, suggestions });
}
