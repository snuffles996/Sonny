// Tracks which list names exist per user so searchUserLists can enumerate them
// without scanning all Redis keys on every query.
// Key pattern: list-index:{userId} → string[]

import { getRedisClient } from "@/lib/redis/client";

const indexKey = (userId: string) => `list-index:${userId}`;

export async function addToListIndex(userId: string, listName: string): Promise<void> {
  const redis = getRedisClient();
  const key = indexKey(userId);
  const current = (await redis.get<string[]>(key)) ?? [];
  const normalized = listName.toLowerCase().trim();
  if (!current.includes(normalized)) {
    await redis.set(key, [...current, normalized]);
  }
}

export async function getUserListIndex(userId: string): Promise<string[]> {
  const redis = getRedisClient();
  return (await redis.get<string[]>(indexKey(userId))) ?? [];
}
