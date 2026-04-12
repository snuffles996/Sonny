import { getRedisClient } from "@/lib/redis/client";
import { getPantryStaples } from "@/lib/pantry/store";

const PANTRY_KEY = "mealplan:shared:pantry_exclusions";

export const DEFAULT_EXCLUSIONS: string[] = [
  "oil", "olive oil", "vegetable oil", "canola oil", "coconut oil", "sesame oil",
  "butter", "salt", "kosher salt", "sea salt",
  "pepper", "black pepper", "white pepper", "red pepper flakes",
  "sugar", "brown sugar", "powdered sugar",
  "flour", "all-purpose flour",
  "baking soda", "baking powder",
  "garlic powder", "onion powder", "paprika", "cumin", "oregano",
  "chili powder", "cayenne pepper", "coriander", "turmeric",
  "dried thyme", "dried rosemary", "dried basil", "dried oregano",
  "italian seasoning", "cinnamon", "nutmeg", "bay leaves",
  "soy sauce", "vinegar", "water",
];

export async function getExclusions(): Promise<string[]> {
  const redis = getRedisClient();
  const stored = await redis.get<string[]>(PANTRY_KEY);
  return stored ?? DEFAULT_EXCLUSIONS;
}

export async function addExclusion(name: string): Promise<string[]> {
  const redis = getRedisClient();
  const current = await getExclusions();
  const normalized = name.toLowerCase().trim();
  if (!normalized || current.includes(normalized)) return current;
  const updated = [...current, normalized];
  await redis.set(PANTRY_KEY, updated);
  return updated;
}

// Returns the union of the fixed exclusions list and the user-editable
// pantry staples (pantry:shared). This is what buildGroceryList should use.
export async function getCombinedExclusions(): Promise<string[]> {
  const [fixed, userEditable] = await Promise.all([getExclusions(), getPantryStaples()]);
  return Array.from(new Set([...fixed, ...userEditable]));
}

export async function removeExclusion(name: string): Promise<string[]> {
  const redis = getRedisClient();
  const current = await getExclusions();
  const normalized = name.toLowerCase().trim();
  const updated = current.filter((e) => e !== normalized);
  await redis.set(PANTRY_KEY, updated);
  return updated;
}
