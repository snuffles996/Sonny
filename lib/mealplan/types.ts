import type { UserId } from "@/lib/profile/types";

export type MealType = "breakfast" | "lunch" | "dinner" | "snack" | "dessert";

export interface PlannedMeal {
  recipeSlug: string;
  recipeName: string;
  addedBy: UserId;
  mealType?: MealType;     // defaults to "dinner" when absent (all legacy data is dinners)
  servings?: number;       // per-meal override of plan-level servings
  made: boolean;
  madeBy?: UserId;
  madeAt?: string;         // ISO timestamp
  notes?: string;
}

export interface MealPlan {
  createdAt: string;       // ISO timestamp
  updatedAt: string;       // ISO timestamp
  updatedBy: UserId;
  meals: PlannedMeal[];
  servings: number;        // default servings for this plan
}
