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
