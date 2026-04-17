// GET/POST/PATCH/DELETE /api/mealplan
// GET    — return active plan
// POST   — create or replace active plan
// PATCH  — update a single meal (check off, swap, notes)
// DELETE — clear active plan (archive to history)

import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getActivePlan, saveActivePlan, clearActivePlan, clearGroceryList } from "@/lib/mealplan/store";
import { getRecipes, setRecipes } from "@/lib/recipes/store";
import type { MealPlan, PlannedMeal } from "@/lib/mealplan/types";

export async function GET(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await getActivePlan();
  return NextResponse.json({ plan });
}

export async function POST(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.meals) return NextResponse.json({ error: "meals required" }, { status: 400 });

  const { meals, servings } = body as { meals: PlannedMeal[]; servings?: number };
  const plan: MealPlan = {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: userId,
    meals,
    servings: servings ?? parseInt(process.env.DEFAULT_SERVINGS ?? "2", 10),
  };
  await saveActivePlan(plan);
  await clearGroceryList();
  return NextResponse.json({ plan });
}

export async function PATCH(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });

  const { slug, made, notes, replacementSlug, servings, removeMealSlug, addSlug } = body as {
    slug?: string;
    made?: boolean;
    notes?: string;
    replacementSlug?: string;
    servings?: number;
    removeMealSlug?: string;
    addSlug?: string;
  };

  const plan = await getActivePlan();
  if (!plan) return NextResponse.json({ error: "No active plan" }, { status: 404 });

  // Remove a single meal from the plan
  if (removeMealSlug) {
    plan.meals = plan.meals.filter((m) => m.recipeSlug !== removeMealSlug);
    plan.updatedAt = new Date().toISOString();
    plan.updatedBy = userId;
    await saveActivePlan(plan);
    await clearGroceryList();
    return NextResponse.json({ plan });
  }

  // Add a single meal to the plan
  if (addSlug) {
    const recipes = await getRecipes();
    const recipe = recipes.find((r) => r.slug === addSlug);
    if (!recipe) return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    if (plan.meals.some((m) => m.recipeSlug === addSlug)) {
      return NextResponse.json({ error: "Recipe already in plan" }, { status: 409 });
    }
    plan.meals.push({ recipeSlug: recipe.slug, recipeName: recipe.name, addedBy: userId, made: false });
    plan.updatedAt = new Date().toISOString();
    plan.updatedBy = userId;
    await saveActivePlan(plan);
    await clearGroceryList();
    return NextResponse.json({ plan });
  }

  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
  const idx = plan.meals.findIndex((m) => m.recipeSlug === slug);
  if (idx < 0) return NextResponse.json({ error: "Meal not found" }, { status: 404 });

  // Check off a meal as made
  if (made !== undefined) {
    plan.meals[idx].made = made;
    if (made) {
      plan.meals[idx].madeBy = userId;
      plan.meals[idx].madeAt = new Date().toISOString();
    }
    if (notes !== undefined) plan.meals[idx].notes = notes;

    // Update lastMade on the recipe
    const recipes = await getRecipes();
    const recipeIdx = recipes.findIndex((r) => r.slug === slug);
    if (recipeIdx >= 0) {
      recipes[recipeIdx].lastMade = new Date().toISOString().split("T")[0];
      if (notes) recipes[recipeIdx].notes = notes;
      await setRecipes(recipes);
    }
  }

  // Update per-meal serving count
  if (servings !== undefined) {
    plan.meals[idx].servings = Math.min(Math.max(servings, 1), 10);
  }

  // Swap a meal for a different recipe
  if (replacementSlug) {
    const recipes = await getRecipes();
    const replacement = recipes.find((r) => r.slug === replacementSlug);
    if (!replacement) return NextResponse.json({ error: "Replacement recipe not found" }, { status: 404 });
    plan.meals[idx] = {
      recipeSlug: replacement.slug,
      recipeName: replacement.name,
      addedBy: userId,
      made: false,
    };
    await clearGroceryList();
  }

  plan.updatedAt = new Date().toISOString();
  plan.updatedBy = userId;
  await saveActivePlan(plan);
  return NextResponse.json({ plan });
}

export async function DELETE(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await clearActivePlan(userId);
  return NextResponse.json({ ok: true });
}
