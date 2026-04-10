// Vercel KV helpers for short-term session storage (last 3–5 turns)
// This is for ordering only — semantic search goes through Pinecone.

import { Redis } from "@upstash/redis";
import type { UserId } from "@/lib/profile/types";

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

export interface Turn {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

const MAX_TURNS = 5;
const SESSION_TTL = 60 * 60 * 4; // 4 hours

function sessionKey(userId: UserId): string {
  return `session:${userId}`;
}

export async function getRecentTurns(userId: UserId): Promise<Turn[]> {
  const turns = await redis.get<Turn[]>(sessionKey(userId));
  return turns ?? [];
}

export async function appendTurn(userId: UserId, turn: Turn): Promise<void> {
  const turns = await getRecentTurns(userId);
  const updated = [...turns, turn].slice(-MAX_TURNS);
  await redis.set(sessionKey(userId), updated, { ex: SESSION_TTL });
}

export async function clearSession(userId: UserId): Promise<void> {
  await redis.del(sessionKey(userId));
}
