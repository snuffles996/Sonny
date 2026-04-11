import { getRedisClient } from "@/lib/redis/client";
import type { SkinLogEntry, TimeOfDay, SkinProduct } from "./types";

function key(userId: string) {
  return `skinlog:${userId}`;
}

export async function getEntries(userId: string): Promise<SkinLogEntry[]> {
  const redis = getRedisClient();
  return (await redis.get<SkinLogEntry[]>(key(userId))) ?? [];
}

export async function addEntry(
  userId: string,
  data: { date: string; time: TimeOfDay; products: SkinProduct[]; symptoms: string; rating: 1 | 2 | 3 | 4 | 5; notes?: string }
): Promise<SkinLogEntry> {
  const entries = await getEntries(userId);
  const entry: SkinLogEntry = {
    id: crypto.randomUUID(),
    userId,
    createdAt: new Date().toISOString(),
    ...data,
  };
  entries.push(entry);
  const redis = getRedisClient();
  await redis.set(key(userId), entries);
  return entry;
}

export async function deleteEntry(userId: string, id: string): Promise<void> {
  const entries = await getEntries(userId);
  const updated = entries.filter((e) => e.id !== id);
  const redis = getRedisClient();
  await redis.set(key(userId), updated);
}
