import { getRedisClient } from "@/lib/redis/client";
import type { Recipe } from "./types";

const KEY = "data:recipes";

export async function getRecipes(): Promise<Recipe[]> {
  const redis = getRedisClient();
  const data = await redis.get<Recipe[]>(KEY);
  return data ?? [];
}

export async function setRecipes(recipes: Recipe[]): Promise<void> {
  const redis = getRedisClient();
  await redis.set(KEY, recipes);
}

export async function removeRecipe(slug: string): Promise<void> {
  const recipes = await getRecipes();
  await setRecipes(recipes.filter((r) => r.slug !== slug));
}

export async function addRecipe(recipe: Recipe): Promise<void> {
  const recipes = await getRecipes();
  // Replace if same slug already exists, otherwise append
  const idx = recipes.findIndex((r) => r.slug === recipe.slug);
  if (idx >= 0) {
    recipes[idx] = recipe;
  } else {
    recipes.push(recipe);
  }
  await setRecipes(recipes);
}
