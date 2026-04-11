import { getRedisClient } from "@/lib/redis/client";
import type { UserId } from "@/lib/profile/types";
import type { MealPlan, MealPlanPrefs } from "./types";

const ACTIVE_KEY = "mealplan:shared:active";
const HISTORY_KEY = "mealplan:shared:history";
const PREFS_KEY = "mealplan:shared:prefs";

const DEFAULT_PREFS: MealPlanPrefs = {
  defaultRemindersListName: "Grocery",
};

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
}

export async function getPlanHistory(): Promise<MealPlan[]> {
  const redis = getRedisClient();
  return (await redis.get<MealPlan[]>(HISTORY_KEY)) ?? [];
}

export async function getPrefs(): Promise<MealPlanPrefs> {
  const redis = getRedisClient();
  const stored = await redis.get<MealPlanPrefs>(PREFS_KEY);
  return stored ?? DEFAULT_PREFS;
}

export async function savePrefs(updates: Partial<MealPlanPrefs>): Promise<void> {
  const redis = getRedisClient();
  const current = await getPrefs();
  await redis.set(PREFS_KEY, { ...current, ...updates });
}
