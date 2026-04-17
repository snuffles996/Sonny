// GET /api/sports/score?team=:team — most recent score (scans last 3 days)
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { detectTeam, getScore } from "@/lib/sports/lookup";

export async function GET(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teamQuery = req.nextUrl.searchParams.get("team") ?? "";
  const team = detectTeam(teamQuery);
  if (!team) return NextResponse.json({ error: `Team not recognized: ${teamQuery}` }, { status: 404 });

  const score = await getScore(team, 3);
  if (!score) return NextResponse.json({ error: `No recent score found for ${team.fullName}` }, { status: 404 });

  return NextResponse.json({ team: team.fullName, score });
}
