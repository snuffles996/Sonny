import { getRedisClient } from "@/lib/redis/client";

const PANTRY_KEY = "pantry:shared";
const LEGACY_KEY = "mealplan:shared:pantry_exclusions";

const DEFAULT_STAPLES: string[] = [
  "oil", "olive oil", "vegetable oil", "canola oil", "coconut oil", "sesame oil",
  "butter", "salt", "kosher salt", "sea salt",
  "pepper", "black pepper", "white pepper", "red pepper flakes",
  "sugar", "brown sugar", "powdered sugar",
  "flour", "all-purpose flour",
  "baking soda", "baking powder",
  "garlic", "garlic powder", "onions", "onion powder",
  "paprika", "cumin", "oregano", "dried oregano",
  "chili powder", "cayenne pepper", "coriander", "turmeric",
  "dried thyme", "dried rosemary", "dried basil",
  "italian seasoning", "cinnamon", "nutmeg", "bay leaves",
  "soy sauce", "vinegar", "water",
  "chicken broth", "canned tomatoes",
  "pasta", "rice", "eggs", "milk",
  "parmesan",
];

export async function getPantryStaples(): Promise<string[]> {
  const redis = getRedisClient();
  const [raw, legacy] = await Promise.all([
    redis.get<string[]>(PANTRY_KEY),
    redis.get<string[]>(LEGACY_KEY),
  ]);

  if (legacy) {
    // One-time migration: absorb the legacy pantry_exclusions key
    const base = raw ?? DEFAULT_STAPLES;
    const merged = Array.from(new Set([...base, ...legacy]));
    await Promise.all([redis.set(PANTRY_KEY, merged), redis.del(LEGACY_KEY)]);
    return merged;
  }

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
