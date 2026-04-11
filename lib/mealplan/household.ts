import { getRedisClient } from "@/lib/redis/client";

const HOUSEHOLD_KEY = "mealplan:shared:household_items";

export const DEFAULT_HOUSEHOLD: string[] = [
  "paper towels", "toilet paper", "dish soap", "laundry detergent",
  "trash bags", "zip lock bags", "plastic wrap", "aluminum foil", "parchment paper",
  "sponges", "hand soap", "shampoo", "conditioner", "body wash",
  "toothpaste", "floss", "deodorant",
];

export async function getHouseholdItems(): Promise<string[]> {
  const redis = getRedisClient();
  const stored = await redis.get<string[]>(HOUSEHOLD_KEY);
  return stored ?? DEFAULT_HOUSEHOLD;
}

export async function addHouseholdItem(name: string): Promise<string[]> {
  const items = await getHouseholdItems();
  const normalized = name.trim().toLowerCase();
  if (items.some((i) => i.toLowerCase() === normalized)) return items;
  const updated = [...items, name.trim()];
  const redis = getRedisClient();
  await redis.set(HOUSEHOLD_KEY, updated);
  return updated;
}

export async function removeHouseholdItem(name: string): Promise<string[]> {
  const items = await getHouseholdItems();
  const updated = items.filter((i) => i.toLowerCase() !== name.trim().toLowerCase());
  const redis = getRedisClient();
  await redis.set(HOUSEHOLD_KEY, updated);
  return updated;
}
