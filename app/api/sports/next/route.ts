// GET /api/sports/next?team=:team — next upcoming game for a team (scans 7 days ahead)
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { detectTeam, findGame } from "@/lib/sports/lookup";
import { USER_TIMEZONE } from "@/lib/caldav/events";

export async function GET(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teamQuery = req.nextUrl.searchParams.get("team") ?? "";
  const team = detectTeam(teamQuery);
  if (!team) return NextResponse.json({ error: `Team not recognized: ${teamQuery}` }, { status: 404 });

  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    const stamp = d.toLocaleDateString("en-CA", { timeZone: USER_TIMEZONE }).replace(/-/g, "");
    const game = await findGame(team, stamp);
    if (game) return NextResponse.json({ team: team.fullName, game });
  }

  return NextResponse.json({ error: `No ${team.fullName} games found in the next 7 days` }, { status: 404 });
}
