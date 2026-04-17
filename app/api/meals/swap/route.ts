// POST /api/meals/swap — swap a meal in the active plan
// Body: { targetSlug?: string; message?: string; preferences?: string }
//   targetSlug: the recipeSlug to replace (skip Haiku identification if provided)
//   message:    natural language (e.g. "swap the pasta") — used when targetSlug omitted
//   preferences: optional flavour hint passed to selectMeals
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getActivePlan, saveActivePlan, clearGroceryList } from "@/lib/mealplan/store";
import { getRecipes } from "@/lib/recipes/store";
import { identifySwapTarget } from "@/lib/anthropic/mealplan";
import { selectMeals } from "@/lib/mealplan/select";
import { getProfile } from "@/lib/profile/store";
import type { PlannedMeal } from "@/lib/mealplan/types";

export async function POST(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as {
    targetSlug?: string;
    message?: string;
    preferences?: string;
  } | null;

  const plan = await getActivePlan();
  if (!plan || plan.meals.length === 0) {
    return NextResponse.json({ error: "No active meal plan" }, { status: 404 });
  }

  let targetSlug = body?.targetSlug ?? null;

  if (!targetSlug) {
    if (!body?.message) {
      return NextResponse.json({ error: "targetSlug or message required" }, { status: 400 });
    }
    targetSlug = await identifySwapTarget(body.message, plan.meals);
    if (!targetSlug) {
      return NextResponse.json({ error: "Could not identify which meal to swap" }, { status: 422 });
    }
  }

  const idx = plan.meals.findIndex((m) => m.recipeSlug === targetSlug);
  if (idx === -1) {
    return NextResponse.json({ error: `Meal '${targetSlug}' not in active plan` }, { status: 404 });
  }

  const [recipes, profile] = await Promise.all([getRecipes(), getProfile(userId)]);

  const replacement = await selectMeals({
    allRecipes: recipes,
    activePlan: plan,
    profile,
    busyNights: [],
    count: 1,
    preferences: body?.preferences ?? body?.message,
  });

  if (replacement.length === 0) {
    return NextResponse.json({ error: "No suitable replacement found" }, { status: 422 });
  }

  const newMeal = replacement[0];
  const oldName = plan.meals[idx].recipeName;
  const updatedMeal: PlannedMeal = {
    recipeSlug: newMeal.recipe.slug,
    recipeName: newMeal.recipe.name,
    addedBy: userId,
    made: false,
  };

  plan.meals[idx] = updatedMeal;
  plan.updatedAt = new Date().toISOString();
  plan.updatedBy = userId;

  await saveActivePlan(plan);
  await clearGroceryList();

  return NextResponse.json({
    swapped: true,
    removed: { slug: targetSlug, name: oldName },
    added: { slug: newMeal.recipe.slug, name: newMeal.recipe.name, reason: newMeal.reason },
    plan,
  });
}
