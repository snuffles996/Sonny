import { getRedisClient } from "@/lib/redis/client";
import type { UserId, UserProfile } from "./types";

const DEFAULTS: Record<UserId, UserProfile> = {
  kevin: {
    userId: "kevin",
    homeLocation: "",
    workLocation: "",
    commuteCorridor: "",
    hobbiesAndInterests: [],
    dietaryPreferences: [],
    standingContext: "",
    updatedAt: new Date().toISOString(),
  },
  sarah: {
    userId: "sarah",
    homeLocation: "",
    workLocation: "",
    commuteCorridor: "",
    hobbiesAndInterests: [],
    dietaryPreferences: [],
    standingContext: "",
    updatedAt: new Date().toISOString(),
  },
};

export async function getProfile(userId: UserId): Promise<UserProfile> {
  const redis = getRedisClient();
  const profile = await redis.get<UserProfile>(`profile:${userId}`);
  return profile ?? DEFAULTS[userId];
}

export async function saveProfile(
  userId: UserId,
  updates: Partial<Omit<UserProfile, "userId" | "updatedAt">>
): Promise<UserProfile> {
  const redis = getRedisClient();
  const current = await getProfile(userId);
  const updated: UserProfile = {
    ...current,
    ...updates,
    userId,
    updatedAt: new Date().toISOString(),
  };
  await redis.set(`profile:${userId}`, updated);
  return updated;
}
