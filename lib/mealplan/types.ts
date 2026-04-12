import type { UserId } from "@/lib/profile/types";

export interface PlannedMeal {
  recipeSlug: string;
  recipeName: string;
  addedBy: UserId;
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
