// GET /api/sports/schedule?team=:team&games=:n — upcoming schedule (default 5 games)
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { detectTeam, getSchedule } from "@/lib/sports/lookup";

export async function GET(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teamQuery = req.nextUrl.searchParams.get("team") ?? "";
  const team = detectTeam(teamQuery);
  if (!team) return NextResponse.json({ error: `Team not recognized: ${teamQuery}` }, { status: 404 });

  const numGames = Math.min(parseInt(req.nextUrl.searchParams.get("games") ?? "5", 10), 20);
  const games = await getSchedule(team, numGames);

  return NextResponse.json({ team: team.fullName, games });
}
