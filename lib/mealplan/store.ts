import { getRedisClient } from "@/lib/redis/client";
import type { UserId } from "@/lib/profile/types";
import type { MealPlan } from "./types";
import type { GroceryItem } from "./grocery";

const ACTIVE_KEY = "mealplan:shared:active";
const HISTORY_KEY = "mealplan:shared:history";
const GROCERY_KEY = "mealplan:shared:grocery";

interface StoredGrocery {
  items: GroceryItem[];
  checkedItems: string[];
}

export async function getActivePlan(): Promise<MealPlan | null> {
  const redis = getRedisClient();
  return redis.get<MealPlan>(ACTIVE_KEY);
}

export async function saveActivePlan(plan: MealPlan): Promise<void> {
  const redis = getRedisClient();
  await redis.set(ACTIVE_KEY, plan);
}

export async function clearActivePlan(userId: UserId): Promise<void> {
  const redis = getRedisClient();
  const current = await redis.get<MealPlan>(ACTIVE_KEY);
  if (current) {
    const history = (await redis.get<MealPlan[]>(HISTORY_KEY)) ?? [];
    history.push({ ...current, updatedAt: new Date().toISOString(), updatedBy: userId });
    await redis.set(HISTORY_KEY, history);
  }
  await redis.del(ACTIVE_KEY);
  await redis.del(GROCERY_KEY);
}

export async function getPlanHistory(): Promise<MealPlan[]> {
  const redis = getRedisClient();
  return (await redis.get<MealPlan[]>(HISTORY_KEY)) ?? [];
}

// ── Grocery list ──────────────────────────────────────────────────────────────

export async function getGroceryList(): Promise<StoredGrocery | null> {
  const redis = getRedisClient();
  return redis.get<StoredGrocery>(GROCERY_KEY);
}

export async function saveGroceryList(items: GroceryItem[]): Promise<void> {
  const redis = getRedisClient();
  const current = await redis.get<StoredGrocery>(GROCERY_KEY);
  await redis.set(GROCERY_KEY, { items, checkedItems: current?.checkedItems ?? [] });
}

export async function toggleGroceryItem(itemName: string): Promise<string[]> {
  const redis = getRedisClient();
  const stored = await redis.get<StoredGrocery>(GROCERY_KEY);
  if (!stored) return [];
  const checked = stored.checkedItems ?? [];
  const updated = checked.includes(itemName)
    ? checked.filter((n) => n !== itemName)
    : [...checked, itemName];
  await redis.set(GROCERY_KEY, { ...stored, checkedItems: updated });
  return updated;
}

export async function clearGroceryList(): Promise<void> {
  const redis = getRedisClient();
  await redis.del(GROCERY_KEY);
}
