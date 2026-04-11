// GET/POST/PATCH/DELETE /api/mealplan
// GET    — return active plan
// POST   — create or replace active plan
// PATCH  — update a single meal (check off, swap, notes)
// DELETE — clear active plan (archive to history)

import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getActivePlan, saveActivePlan, clearActivePlan } from "@/lib/mealplan/store";
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
    groceryListSent: false,
  };
  await saveActivePlan(plan);
  return NextResponse.json({ plan });
}

export async function PATCH(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.slug) return NextResponse.json({ error: "slug required" }, { status: 400 });

  const { slug, made, notes, replacementSlug, servings } = body as {
    slug: string;
    made?: boolean;
    notes?: string;
    replacementSlug?: string;
    servings?: number;
  };

  const plan = await getActivePlan();
  if (!plan) return NextResponse.json({ error: "No active plan" }, { status: 404 });

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
