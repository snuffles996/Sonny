// Sports game lookup via ESPN's public API (no key required).
// Supports NFL, MLB, NBA, NHL.

import { USER_TIMEZONE } from "@/lib/caldav/events";

export interface GameInfo {
  title: string;       // "San Diego Padres vs Colorado Rockies"
  homeTeam: string;
  awayTeam: string;
  startTimeUTC: string; // ISO 8601
  startLocal: string;   // "YYYYMMDDTHHMMSS" in USER_TIMEZONE
  endLocal: string;     // startLocal + typical game duration
  venue: string;
  isHome: boolean;
}

interface TeamEntry {
  sport: "baseball/mlb" | "football/nfl" | "basketball/nba" | "hockey/nhl";
  abbr: string;          // ESPN team abbreviation
  fullName: string;
  gameDurationHours: number;
}

const TEAMS: Record<string, TeamEntry> = {
  // ── MLB ───────────────────────────────────────────────────────────────────
  "padres":              { sport: "baseball/mlb", abbr: "SD",  fullName: "San Diego Padres",       gameDurationHours: 3 },
  "san diego padres":    { sport: "baseball/mlb", abbr: "SD",  fullName: "San Diego Padres",       gameDurationHours: 3 },
  "dodgers":             { sport: "baseball/mlb", abbr: "LAD", fullName: "Los Angeles Dodgers",    gameDurationHours: 3 },
  "giants":              { sport: "baseball/mlb", abbr: "SF",  fullName: "San Francisco Giants",   gameDurationHours: 3 },
  "yankees":             { sport: "baseball/mlb", abbr: "NYY", fullName: "New York Yankees",       gameDurationHours: 3 },
  "red sox":             { sport: "baseball/mlb", abbr: "BOS", fullName: "Boston Red Sox",         gameDurationHours: 3 },
  "cubs":                { sport: "baseball/mlb", abbr: "CHC", fullName: "Chicago Cubs",           gameDurationHours: 3 },
  "cardinals":           { sport: "baseball/mlb", abbr: "STL", fullName: "St. Louis Cardinals",    gameDurationHours: 3 },
  "braves":              { sport: "baseball/mlb", abbr: "ATL", fullName: "Atlanta Braves",         gameDurationHours: 3 },
  "astros":              { sport: "baseball/mlb", abbr: "HOU", fullName: "Houston Astros",         gameDurationHours: 3 },
  "mets":                { sport: "baseball/mlb", abbr: "NYM", fullName: "New York Mets",          gameDurationHours: 3 },
  "phillies":            { sport: "baseball/mlb", abbr: "PHI", fullName: "Philadelphia Phillies",  gameDurationHours: 3 },
  "mariners":            { sport: "baseball/mlb", abbr: "SEA", fullName: "Seattle Mariners",       gameDurationHours: 3 },
  "rangers":             { sport: "baseball/mlb", abbr: "TEX", fullName: "Texas Rangers",          gameDurationHours: 3 },
  "athletics":           { sport: "baseball/mlb", abbr: "ATH", fullName: "Athletics",              gameDurationHours: 3 },
  "a's":                 { sport: "baseball/mlb", abbr: "ATH", fullName: "Athletics",              gameDurationHours: 3 },
  // ── NFL ───────────────────────────────────────────────────────────────────
  "49ers":               { sport: "football/nfl", abbr: "SF",  fullName: "San Francisco 49ers",    gameDurationHours: 3.5 },
  "niners":              { sport: "football/nfl", abbr: "SF",  fullName: "San Francisco 49ers",    gameDurationHours: 3.5 },
  "san francisco 49ers": { sport: "football/nfl", abbr: "SF",  fullName: "San Francisco 49ers",    gameDurationHours: 3.5 },
  "chiefs":              { sport: "football/nfl", abbr: "KC",  fullName: "Kansas City Chiefs",     gameDurationHours: 3.5 },
  "cowboys":             { sport: "football/nfl", abbr: "DAL", fullName: "Dallas Cowboys",         gameDurationHours: 3.5 },
  "eagles":              { sport: "football/nfl", abbr: "PHI", fullName: "Philadelphia Eagles",    gameDurationHours: 3.5 },
  "patriots":            { sport: "football/nfl", abbr: "NE",  fullName: "New England Patriots",   gameDurationHours: 3.5 },
  "seahawks":            { sport: "football/nfl", abbr: "SEA", fullName: "Seattle Seahawks",       gameDurationHours: 3.5 },
  "packers":             { sport: "football/nfl", abbr: "GB",  fullName: "Green Bay Packers",      gameDurationHours: 3.5 },
  "bills":               { sport: "football/nfl", abbr: "BUF", fullName: "Buffalo Bills",          gameDurationHours: 3.5 },
  "ravens":              { sport: "football/nfl", abbr: "BAL", fullName: "Baltimore Ravens",       gameDurationHours: 3.5 },
  "rams":                { sport: "football/nfl", abbr: "LAR", fullName: "Los Angeles Rams",       gameDurationHours: 3.5 },
  "chargers":            { sport: "football/nfl", abbr: "LAC", fullName: "Los Angeles Chargers",   gameDurationHours: 3.5 },
  "raiders":             { sport: "football/nfl", abbr: "LV",  fullName: "Las Vegas Raiders",      gameDurationHours: 3.5 },
  "broncos":             { sport: "football/nfl", abbr: "DEN", fullName: "Denver Broncos",         gameDurationHours: 3.5 },
  "steelers":            { sport: "football/nfl", abbr: "PIT", fullName: "Pittsburgh Steelers",    gameDurationHours: 3.5 },
  "bears":               { sport: "football/nfl", abbr: "CHI", fullName: "Chicago Bears",          gameDurationHours: 3.5 },
  "vikings":             { sport: "football/nfl", abbr: "MIN", fullName: "Minnesota Vikings",      gameDurationHours: 3.5 },
  "lions":               { sport: "football/nfl", abbr: "DET", fullName: "Detroit Lions",          gameDurationHours: 3.5 },
  "saints":              { sport: "football/nfl", abbr: "NO",  fullName: "New Orleans Saints",     gameDurationHours: 3.5 },
  "buccaneers":          { sport: "football/nfl", abbr: "TB",  fullName: "Tampa Bay Buccaneers",   gameDurationHours: 3.5 },
  "falcons":             { sport: "football/nfl", abbr: "ATL", fullName: "Atlanta Falcons",        gameDurationHours: 3.5 },
  "panthers":            { sport: "football/nfl", abbr: "CAR", fullName: "Carolina Panthers",      gameDurationHours: 3.5 },
  "commanders":          { sport: "football/nfl", abbr: "WSH", fullName: "Washington Commanders",  gameDurationHours: 3.5 },
  "giants nfl":          { sport: "football/nfl", abbr: "NYG", fullName: "New York Giants",        gameDurationHours: 3.5 },
  "jets":                { sport: "football/nfl", abbr: "NYJ", fullName: "New York Jets",          gameDurationHours: 3.5 },
  "browns":              { sport: "football/nfl", abbr: "CLE", fullName: "Cleveland Browns",       gameDurationHours: 3.5 },
  "colts":               { sport: "football/nfl", abbr: "IND", fullName: "Indianapolis Colts",     gameDurationHours: 3.5 },
  "jaguars":             { sport: "football/nfl", abbr: "JAX", fullName: "Jacksonville Jaguars",   gameDurationHours: 3.5 },
  "titans":              { sport: "football/nfl", abbr: "TEN", fullName: "Tennessee Titans",       gameDurationHours: 3.5 },
  "texans":              { sport: "football/nfl", abbr: "HOU", fullName: "Houston Texans",         gameDurationHours: 3.5 },
  "dolphins":            { sport: "football/nfl", abbr: "MIA", fullName: "Miami Dolphins",         gameDurationHours: 3.5 },
  "bengals":             { sport: "football/nfl", abbr: "CIN", fullName: "Cincinnati Bengals",     gameDurationHours: 3.5 },
  // ── NBA ───────────────────────────────────────────────────────────────────
  "warriors":            { sport: "basketball/nba", abbr: "GS",  fullName: "Golden State Warriors", gameDurationHours: 2.5 },
  "lakers":              { sport: "basketball/nba", abbr: "LAL", fullName: "Los Angeles Lakers",    gameDurationHours: 2.5 },
  "celtics":             { sport: "basketball/nba", abbr: "BOS", fullName: "Boston Celtics",        gameDurationHours: 2.5 },
  "clippers":            { sport: "basketball/nba", abbr: "LAC", fullName: "Los Angeles Clippers",  gameDurationHours: 2.5 },
  "nuggets":             { sport: "basketball/nba", abbr: "DEN", fullName: "Denver Nuggets",        gameDurationHours: 2.5 },
  "bucks":               { sport: "basketball/nba", abbr: "MIL", fullName: "Milwaukee Bucks",       gameDurationHours: 2.5 },
  "heat":                { sport: "basketball/nba", abbr: "MIA", fullName: "Miami Heat",            gameDurationHours: 2.5 },
  "76ers":               { sport: "basketball/nba", abbr: "PHI", fullName: "Philadelphia 76ers",    gameDurationHours: 2.5 },
  "sixers":              { sport: "basketball/nba", abbr: "PHI", fullName: "Philadelphia 76ers",    gameDurationHours: 2.5 },
  "suns":                { sport: "basketball/nba", abbr: "PHX", fullName: "Phoenix Suns",          gameDurationHours: 2.5 },
  "knicks":              { sport: "basketball/nba", abbr: "NY",  fullName: "New York Knicks",       gameDurationHours: 2.5 },
  "spurs":               { sport: "basketball/nba", abbr: "SA",  fullName: "San Antonio Spurs",     gameDurationHours: 2.5 },
  // ── NHL ───────────────────────────────────────────────────────────────────
  "ducks":               { sport: "hockey/nhl", abbr: "ANA", fullName: "Anaheim Ducks",            gameDurationHours: 2.5 },
  "kings nhl":           { sport: "hockey/nhl", abbr: "LA",  fullName: "Los Angeles Kings",        gameDurationHours: 2.5 },
  "sharks":              { sport: "hockey/nhl", abbr: "SJS", fullName: "San Jose Sharks",          gameDurationHours: 2.5 },
  "golden knights":      { sport: "hockey/nhl", abbr: "VGK", fullName: "Vegas Golden Knights",     gameDurationHours: 2.5 },
  "avalanche":           { sport: "hockey/nhl", abbr: "COL", fullName: "Colorado Avalanche",       gameDurationHours: 2.5 },
  "blackhawks":          { sport: "hockey/nhl", abbr: "CHI", fullName: "Chicago Blackhawks",       gameDurationHours: 2.5 },
  "bruins":              { sport: "hockey/nhl", abbr: "BOS", fullName: "Boston Bruins",            gameDurationHours: 2.5 },
  "maple leafs":         { sport: "hockey/nhl", abbr: "TOR", fullName: "Toronto Maple Leafs",      gameDurationHours: 2.5 },
  "lightning":           { sport: "hockey/nhl", abbr: "TB",  fullName: "Tampa Bay Lightning",      gameDurationHours: 2.5 },
  "penguins":            { sport: "hockey/nhl", abbr: "PIT", fullName: "Pittsburgh Penguins",      gameDurationHours: 2.5 },
  "rangers nhl":         { sport: "hockey/nhl", abbr: "NYR", fullName: "New York Rangers",         gameDurationHours: 2.5 },
};

// Convert a UTC ISO string to "YYYYMMDDTHHMMSS" in USER_TIMEZONE
function utcToLocalStamp(utcIso: string): string {
  const d = new Date(utcIso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: USER_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const p: Record<string, string> = {};
  for (const { type, value } of parts) p[type] = value;
  const h = p.hour === "24" ? "00" : p.hour;
  return `${p.year}${p.month}${p.day}T${h}${p.minute}${p.second}`;
}

function addHours(stamp: string, hours: number): string {
  const iso = `${stamp.slice(0,4)}-${stamp.slice(4,6)}-${stamp.slice(6,8)}T${stamp.slice(9,11)}:${stamp.slice(11,13)}:${stamp.slice(13,15)}`;
  const d = new Date(new Date(iso + "Z").getTime() + hours * 3600 * 1000);
  return utcToLocalStamp(d.toISOString());
}

// Scan message for a known team name, returning the longest match
export function detectTeam(message: string): TeamEntry & { key: string } | null {
  const lower = message.toLowerCase();
  let best: (TeamEntry & { key: string }) | null = null;
  for (const [key, entry] of Object.entries(TEAMS)) {
    if (lower.includes(key) && (!best || key.length > best.key.length)) {
      best = { ...entry, key };
    }
  }
  return best;
}

// Look up a game for a team on a given date (YYYYMMDD in USER_TIMEZONE)
export async function findGame(team: TeamEntry, dateStamp: string): Promise<GameInfo | null> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${team.sport}/scoreboard?dates=${dateStamp}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json() as { events?: ESPN_Event[] };

    for (const event of data.events ?? []) {
      const comp = event.competitions?.[0];
      if (!comp) continue;
      const competitors = comp.competitors ?? [];
      const match = competitors.find(
        (c) => c.team.abbreviation.toUpperCase() === team.abbr.toUpperCase()
      );
      if (!match) continue;

      const isHome = match.homeAway === "home";
      const home = competitors.find((c) => c.homeAway === "home");
      const away = competitors.find((c) => c.homeAway === "away");
      const venue = comp.venue?.fullName ?? "";
      const startLocal = utcToLocalStamp(event.date);
      const endLocal = addHours(startLocal, team.gameDurationHours);

      return {
        title: `${away?.team.displayName ?? "?"} at ${home?.team.displayName ?? "?"}`,
        homeTeam: home?.team.displayName ?? "",
        awayTeam: away?.team.displayName ?? "",
        startTimeUTC: event.date,
        startLocal,
        endLocal,
        venue,
        isHome,
      };
    }
  } catch {
    // network error or timeout — fall through
  }
  return null;
}

// ESPN response types (minimal)
interface ESPN_Event {
  date: string;
  competitions?: {
    competitors?: { homeAway: "home" | "away"; team: { abbreviation: string; displayName: string } }[];
    venue?: { fullName: string };
  }[];
}
