// Vercel KV helpers for short-term session storage (last 3–5 turns)
// This is for ordering only — semantic search goes through Pinecone.

import { getRedisClient } from "@/lib/redis/client";
import type { UserId } from "@/lib/profile/types";

export interface Turn {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

const MAX_TURNS = 10;
const SESSION_TTL = 60 * 60 * 4; // 4 hours

function sessionKey(userId: UserId): string {
  return `session:${userId}`;
}

export async function getRecentTurns(userId: UserId): Promise<Turn[]> {
  const turns = await getRedisClient().get<Turn[]>(sessionKey(userId));
  return turns ?? [];
}

export async function appendTurn(userId: UserId, turn: Turn): Promise<void> {
  const turns = await getRecentTurns(userId);
  const updated = [...turns, turn].slice(-MAX_TURNS);
  await getRedisClient().set(sessionKey(userId), updated, { ex: SESSION_TTL });
}

export async function clearSession(userId: UserId): Promise<void> {
  await getRedisClient().del(sessionKey(userId));
}
