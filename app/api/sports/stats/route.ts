// GET /api/sports/stats?team=:team&player=:player — player stats
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { detectTeam, getPlayerStats } from "@/lib/sports/lookup";

export async function GET(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const player = req.nextUrl.searchParams.get("player") ?? "";
  if (!player) return NextResponse.json({ error: "player required" }, { status: 400 });

  const teamQuery = req.nextUrl.searchParams.get("team") ?? "";
  const team = detectTeam(teamQuery);
  const sport = team?.sport ?? "baseball/mlb";

  const stats = await getPlayerStats(player, sport);
  if (!stats) return NextResponse.json({ error: `No stats found for ${player}` }, { status: 404 });

  return NextResponse.json({ player, sport, stats });
}
