import { getRedisClient } from "@/lib/redis/client";

const OVERRIDES_KEY = "category-overrides:shared";

export async function getOverrides(): Promise<Map<string, string>> {
  const redis = getRedisClient();
  const raw = await redis.get<Record<string, string>>(OVERRIDES_KEY);
  if (!raw) return new Map();
  return new Map(Object.entries(raw));
}

export async function addOverride(item: string, category: string): Promise<void> {
  const existing = await getOverrides();
  existing.set(item.toLowerCase().trim(), category);
  const redis = getRedisClient();
  await redis.set(OVERRIDES_KEY, Object.fromEntries(existing));
}
