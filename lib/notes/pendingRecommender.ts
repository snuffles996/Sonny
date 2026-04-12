// Short-lived Redis state for the "who recommended it?" follow-up conversation.
// Auto-expires after 5 minutes so stale state never blocks future messages.

import { getRedisClient } from "@/lib/redis/client";

const TTL = 300; // seconds

interface PendingRecommender {
  noteText: string;
  savedAt: number;
}

function key(userId: string) {
  return `pending:recommender:${userId}`;
}

export async function savePendingRecommender(userId: string, noteText: string): Promise<void> {
  const redis = getRedisClient();
  await redis.set(key(userId), { noteText, savedAt: Date.now() }, { ex: TTL });
}

export async function getPendingRecommender(userId: string): Promise<PendingRecommender | null> {
  const redis = getRedisClient();
  return redis.get<PendingRecommender>(key(userId));
}

export async function clearPendingRecommender(userId: string): Promise<void> {
  const redis = getRedisClient();
  await redis.del(key(userId));
}
