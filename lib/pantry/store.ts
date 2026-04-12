import { getRedisClient } from "@/lib/redis/client";

const PANTRY_KEY = "pantry:shared";

const DEFAULT_STAPLES: string[] = [
  "olive oil",
  "vegetable oil",
  "salt",
  "black pepper",
  "garlic",
  "onions",
  "butter",
  "flour",
  "sugar",
  "baking soda",
  "baking powder",
  "soy sauce",
  "chicken broth",
  "canned tomatoes",
  "pasta",
  "rice",
  "eggs",
  "milk",
  "parmesan",
  "red pepper flakes",
  "cumin",
  "paprika",
  "oregano",
];

export async function getPantryStaples(): Promise<string[]> {
  const redis = getRedisClient();
  const raw = await redis.get<string[]>(PANTRY_KEY);
  return raw ?? DEFAULT_STAPLES;
}

export async function addStaples(items: string[]): Promise<string[]> {
  const existing = await getPantryStaples();
  const updated = Array.from(
    new Set([...existing, ...items.map((i) => i.toLowerCase().trim())])
  );
  const redis = getRedisClient();
  await redis.set(PANTRY_KEY, updated);
  return updated;
}

export async function removeStaples(items: string[]): Promise<string[]> {
  const existing = await getPantryStaples();
  const toRemove = new Set(items.map((i) => i.toLowerCase().trim()));
  const updated = existing.filter((s) => !toRemove.has(s));
  const redis = getRedisClient();
  await redis.set(PANTRY_KEY, updated);
  return updated;
}
