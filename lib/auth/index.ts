import type { NextRequest } from "next/server";
import type { UserId } from "@/lib/profile/types";

export function authenticateUser(req: NextRequest): UserId | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  if (token === process.env.KEVIN_SECRET) return "kevin";
  if (token === process.env.SARAH_SECRET) return "sarah";
  return null;
}
