// GET /api/sports/standings?league=:league — league standings
// league param accepts: mlb, nfl, nba, nhl (or full sport string like baseball/mlb)
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getStandings } from "@/lib/sports/lookup";

const LEAGUE_MAP: Record<string, string> = {
  mlb: "baseball/mlb",
  nfl: "football/nfl",
  nba: "basketball/nba",
  nhl: "hockey/nhl",
  "baseball/mlb": "baseball/mlb",
  "football/nfl": "football/nfl",
  "basketball/nba": "basketball/nba",
  "hockey/nhl": "hockey/nhl",
};

export async function GET(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const leagueParam = (req.nextUrl.searchParams.get("league") ?? "").toLowerCase();
  const sport = LEAGUE_MAP[leagueParam];
  if (!sport) {
    return NextResponse.json({ error: "league must be one of: mlb, nfl, nba, nhl" }, { status: 400 });
  }

  const standings = await getStandings(sport as Parameters<typeof getStandings>[0]);
  return NextResponse.json({ league: leagueParam, standings });
}
