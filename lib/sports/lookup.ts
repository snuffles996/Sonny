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
  teamId: string;        // ESPN internal team ID (for schedule/standings/stats endpoints)
  gameDurationHours: number;
}

const TEAMS: Record<string, TeamEntry> = {
  // ── MLB ───────────────────────────────────────────────────────────────────
  "padres":              { sport: "baseball/mlb", abbr: "SD",  fullName: "San Diego Padres",       teamId: "25", gameDurationHours: 3 },
  "san diego padres":    { sport: "baseball/mlb", abbr: "SD",  fullName: "San Diego Padres",       teamId: "25", gameDurationHours: 3 },
  "dodgers":             { sport: "baseball/mlb", abbr: "LAD", fullName: "Los Angeles Dodgers",    teamId: "19", gameDurationHours: 3 },
  "giants":              { sport: "baseball/mlb", abbr: "SF",  fullName: "San Francisco Giants",   teamId: "26", gameDurationHours: 3 },
  "yankees":             { sport: "baseball/mlb", abbr: "NYY", fullName: "New York Yankees",       teamId: "10", gameDurationHours: 3 },
  "red sox":             { sport: "baseball/mlb", abbr: "BOS", fullName: "Boston Red Sox",         teamId: "2",  gameDurationHours: 3 },
  "cubs":                { sport: "baseball/mlb", abbr: "CHC", fullName: "Chicago Cubs",           teamId: "16", gameDurationHours: 3 },
  "cardinals":           { sport: "baseball/mlb", abbr: "STL", fullName: "St. Louis Cardinals",    teamId: "24", gameDurationHours: 3 },
  "braves":              { sport: "baseball/mlb", abbr: "ATL", fullName: "Atlanta Braves",         teamId: "15", gameDurationHours: 3 },
  "astros":              { sport: "baseball/mlb", abbr: "HOU", fullName: "Houston Astros",         teamId: "18", gameDurationHours: 3 },
  "mets":                { sport: "baseball/mlb", abbr: "NYM", fullName: "New York Mets",          teamId: "21", gameDurationHours: 3 },
  "phillies":            { sport: "baseball/mlb", abbr: "PHI", fullName: "Philadelphia Phillies",  teamId: "22", gameDurationHours: 3 },
  "mariners":            { sport: "baseball/mlb", abbr: "SEA", fullName: "Seattle Mariners",       teamId: "12", gameDurationHours: 3 },
  "rangers":             { sport: "baseball/mlb", abbr: "TEX", fullName: "Texas Rangers",          teamId: "13", gameDurationHours: 3 },
  "athletics":           { sport: "baseball/mlb", abbr: "ATH", fullName: "Athletics",              teamId: "11", gameDurationHours: 3 },
  "a's":                 { sport: "baseball/mlb", abbr: "ATH", fullName: "Athletics",              teamId: "11", gameDurationHours: 3 },
  // ── NFL ───────────────────────────────────────────────────────────────────
  "49ers":               { sport: "football/nfl", abbr: "SF",  fullName: "San Francisco 49ers",    teamId: "25", gameDurationHours: 3.5 },
  "niners":              { sport: "football/nfl", abbr: "SF",  fullName: "San Francisco 49ers",    teamId: "25", gameDurationHours: 3.5 },
  "san francisco 49ers": { sport: "football/nfl", abbr: "SF",  fullName: "San Francisco 49ers",    teamId: "25", gameDurationHours: 3.5 },
  "chiefs":              { sport: "football/nfl", abbr: "KC",  fullName: "Kansas City Chiefs",     teamId: "12", gameDurationHours: 3.5 },
  "cowboys":             { sport: "football/nfl", abbr: "DAL", fullName: "Dallas Cowboys",         teamId: "6",  gameDurationHours: 3.5 },
  "eagles":              { sport: "football/nfl", abbr: "PHI", fullName: "Philadelphia Eagles",    teamId: "21", gameDurationHours: 3.5 },
  "patriots":            { sport: "football/nfl", abbr: "NE",  fullName: "New England Patriots",   teamId: "17", gameDurationHours: 3.5 },
  "seahawks":            { sport: "football/nfl", abbr: "SEA", fullName: "Seattle Seahawks",       teamId: "26", gameDurationHours: 3.5 },
  "packers":             { sport: "football/nfl", abbr: "GB",  fullName: "Green Bay Packers",      teamId: "9",  gameDurationHours: 3.5 },
  "bills":               { sport: "football/nfl", abbr: "BUF", fullName: "Buffalo Bills",          teamId: "2",  gameDurationHours: 3.5 },
  "ravens":              { sport: "football/nfl", abbr: "BAL", fullName: "Baltimore Ravens",       teamId: "33", gameDurationHours: 3.5 },
  "rams":                { sport: "football/nfl", abbr: "LAR", fullName: "Los Angeles Rams",       teamId: "14", gameDurationHours: 3.5 },
  "chargers":            { sport: "football/nfl", abbr: "LAC", fullName: "Los Angeles Chargers",   teamId: "24", gameDurationHours: 3.5 },
  "raiders":             { sport: "football/nfl", abbr: "LV",  fullName: "Las Vegas Raiders",      teamId: "13", gameDurationHours: 3.5 },
  "broncos":             { sport: "football/nfl", abbr: "DEN", fullName: "Denver Broncos",         teamId: "7",  gameDurationHours: 3.5 },
  "steelers":            { sport: "football/nfl", abbr: "PIT", fullName: "Pittsburgh Steelers",    teamId: "23", gameDurationHours: 3.5 },
  "bears":               { sport: "football/nfl", abbr: "CHI", fullName: "Chicago Bears",          teamId: "3",  gameDurationHours: 3.5 },
  "vikings":             { sport: "football/nfl", abbr: "MIN", fullName: "Minnesota Vikings",      teamId: "16", gameDurationHours: 3.5 },
  "lions":               { sport: "football/nfl", abbr: "DET", fullName: "Detroit Lions",          teamId: "8",  gameDurationHours: 3.5 },
  "saints":              { sport: "football/nfl", abbr: "NO",  fullName: "New Orleans Saints",     teamId: "18", gameDurationHours: 3.5 },
  "buccaneers":          { sport: "football/nfl", abbr: "TB",  fullName: "Tampa Bay Buccaneers",   teamId: "27", gameDurationHours: 3.5 },
  "falcons":             { sport: "football/nfl", abbr: "ATL", fullName: "Atlanta Falcons",        teamId: "1",  gameDurationHours: 3.5 },
  "panthers":            { sport: "football/nfl", abbr: "CAR", fullName: "Carolina Panthers",      teamId: "29", gameDurationHours: 3.5 },
  "commanders":          { sport: "football/nfl", abbr: "WSH", fullName: "Washington Commanders",  teamId: "28", gameDurationHours: 3.5 },
  "giants nfl":          { sport: "football/nfl", abbr: "NYG", fullName: "New York Giants",        teamId: "19", gameDurationHours: 3.5 },
  "jets":                { sport: "football/nfl", abbr: "NYJ", fullName: "New York Jets",          teamId: "20", gameDurationHours: 3.5 },
  "browns":              { sport: "football/nfl", abbr: "CLE", fullName: "Cleveland Browns",       teamId: "5",  gameDurationHours: 3.5 },
  "colts":               { sport: "football/nfl", abbr: "IND", fullName: "Indianapolis Colts",     teamId: "11", gameDurationHours: 3.5 },
  "jaguars":             { sport: "football/nfl", abbr: "JAX", fullName: "Jacksonville Jaguars",   teamId: "30", gameDurationHours: 3.5 },
  "titans":              { sport: "football/nfl", abbr: "TEN", fullName: "Tennessee Titans",       teamId: "10", gameDurationHours: 3.5 },
  "texans":              { sport: "football/nfl", abbr: "HOU", fullName: "Houston Texans",         teamId: "34", gameDurationHours: 3.5 },
  "dolphins":            { sport: "football/nfl", abbr: "MIA", fullName: "Miami Dolphins",         teamId: "15", gameDurationHours: 3.5 },
  "bengals":             { sport: "football/nfl", abbr: "CIN", fullName: "Cincinnati Bengals",     teamId: "4",  gameDurationHours: 3.5 },
  // ── NBA ───────────────────────────────────────────────────────────────────
  "warriors":            { sport: "basketball/nba", abbr: "GS",  fullName: "Golden State Warriors", teamId: "9",  gameDurationHours: 2.5 },
  "lakers":              { sport: "basketball/nba", abbr: "LAL", fullName: "Los Angeles Lakers",    teamId: "13", gameDurationHours: 2.5 },
  "celtics":             { sport: "basketball/nba", abbr: "BOS", fullName: "Boston Celtics",        teamId: "2",  gameDurationHours: 2.5 },
  "clippers":            { sport: "basketball/nba", abbr: "LAC", fullName: "Los Angeles Clippers",  teamId: "12", gameDurationHours: 2.5 },
  "nuggets":             { sport: "basketball/nba", abbr: "DEN", fullName: "Denver Nuggets",        teamId: "7",  gameDurationHours: 2.5 },
  "bucks":               { sport: "basketball/nba", abbr: "MIL", fullName: "Milwaukee Bucks",       teamId: "15", gameDurationHours: 2.5 },
  "heat":                { sport: "basketball/nba", abbr: "MIA", fullName: "Miami Heat",            teamId: "14", gameDurationHours: 2.5 },
  "76ers":               { sport: "basketball/nba", abbr: "PHI", fullName: "Philadelphia 76ers",    teamId: "20", gameDurationHours: 2.5 },
  "sixers":              { sport: "basketball/nba", abbr: "PHI", fullName: "Philadelphia 76ers",    teamId: "20", gameDurationHours: 2.5 },
  "suns":                { sport: "basketball/nba", abbr: "PHX", fullName: "Phoenix Suns",          teamId: "21", gameDurationHours: 2.5 },
  "knicks":              { sport: "basketball/nba", abbr: "NY",  fullName: "New York Knicks",       teamId: "18", gameDurationHours: 2.5 },
  "spurs":               { sport: "basketball/nba", abbr: "SA",  fullName: "San Antonio Spurs",     teamId: "24", gameDurationHours: 2.5 },
  // ── NHL ───────────────────────────────────────────────────────────────────
  "ducks":               { sport: "hockey/nhl", abbr: "ANA", fullName: "Anaheim Ducks",            teamId: "25", gameDurationHours: 2.5 },
  "kings nhl":           { sport: "hockey/nhl", abbr: "LA",  fullName: "Los Angeles Kings",        teamId: "8",  gameDurationHours: 2.5 },
  "sharks":              { sport: "hockey/nhl", abbr: "SJ",  fullName: "San Jose Sharks",          teamId: "18", gameDurationHours: 2.5 },
  "golden knights":      { sport: "hockey/nhl", abbr: "VGK", fullName: "Vegas Golden Knights",     teamId: "37", gameDurationHours: 2.5 },
  "avalanche":           { sport: "hockey/nhl", abbr: "COL", fullName: "Colorado Avalanche",       teamId: "17", gameDurationHours: 2.5 },
  "blackhawks":          { sport: "hockey/nhl", abbr: "CHI", fullName: "Chicago Blackhawks",       teamId: "4",  gameDurationHours: 2.5 },
  "bruins":              { sport: "hockey/nhl", abbr: "BOS", fullName: "Boston Bruins",            teamId: "1",  gameDurationHours: 2.5 },
  "maple leafs":         { sport: "hockey/nhl", abbr: "TOR", fullName: "Toronto Maple Leafs",      teamId: "21", gameDurationHours: 2.5 },
  "lightning":           { sport: "hockey/nhl", abbr: "TB",  fullName: "Tampa Bay Lightning",      teamId: "20", gameDurationHours: 2.5 },
  "penguins":            { sport: "hockey/nhl", abbr: "PIT", fullName: "Pittsburgh Penguins",      teamId: "16", gameDurationHours: 2.5 },
  "rangers nhl":         { sport: "hockey/nhl", abbr: "NYR", fullName: "New York Rangers",         teamId: "13", gameDurationHours: 2.5 },
};

// ── New result types ─────────────────────────────────────────────────────────

export interface ScoreResult {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: "pre" | "in" | "post";
  statusDetail: string;  // e.g. "Final", "Top 5th", "Q3 4:22"
  date: string;          // ISO 8601
  venue: string;
}

export interface ScheduleGame {
  date: string;          // ISO 8601
  startLocal: string;    // YYYYMMDDTHHMMSS in USER_TIMEZONE
  opponent: string;
  homeAway: "home" | "away";
  venue: string;
  status: "pre" | "in" | "post";
}

export interface StandingsEntry {
  teamName: string;
  wins: number;
  losses: number;
  winPct: string;
  gamesBehind: string;
  division: string;
}

export interface PlayerStatsResult {
  name: string;
  team: string;
  position: string;
  stats: Record<string, string>;
  season: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

export function addHours(stamp: string, hours: number): string {
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

// Map division/conference name phrases to sport + ESPN standings filter key
const DIVISION_LOOKUP: { pattern: RegExp; sport: TeamEntry["sport"]; division: string }[] = [
  // MLB
  { pattern: /nl west/i,     sport: "baseball/mlb",    division: "NL West" },
  { pattern: /nl east/i,     sport: "baseball/mlb",    division: "NL East" },
  { pattern: /nl central/i,  sport: "baseball/mlb",    division: "NL Central" },
  { pattern: /al west/i,     sport: "baseball/mlb",    division: "AL West" },
  { pattern: /al east/i,     sport: "baseball/mlb",    division: "AL East" },
  { pattern: /al central/i,  sport: "baseball/mlb",    division: "AL Central" },
  // NFL
  { pattern: /afc east/i,    sport: "football/nfl",    division: "AFC East" },
  { pattern: /afc west/i,    sport: "football/nfl",    division: "AFC West" },
  { pattern: /afc north/i,   sport: "football/nfl",    division: "AFC North" },
  { pattern: /afc south/i,   sport: "football/nfl",    division: "AFC South" },
  { pattern: /nfc east/i,    sport: "football/nfl",    division: "NFC East" },
  { pattern: /nfc west/i,    sport: "football/nfl",    division: "NFC West" },
  { pattern: /nfc north/i,   sport: "football/nfl",    division: "NFC North" },
  { pattern: /nfc south/i,   sport: "football/nfl",    division: "NFC South" },
  // NBA
  { pattern: /pacific/i,     sport: "basketball/nba",  division: "Pacific" },
  { pattern: /northwest/i,   sport: "basketball/nba",  division: "Northwest" },
  { pattern: /southwest/i,   sport: "basketball/nba",  division: "Southwest" },
  { pattern: /atlantic/i,    sport: "basketball/nba",  division: "Atlantic" },
  { pattern: /central/i,     sport: "basketball/nba",  division: "Central" },
  { pattern: /southeast/i,   sport: "basketball/nba",  division: "Southeast" },
  // NHL
  { pattern: /metropolitan/i, sport: "hockey/nhl",     division: "Metropolitan" },
  { pattern: /northeast/i,   sport: "hockey/nhl",      division: "Northeast" },
  { pattern: /north(?!west|east)/i, sport: "hockey/nhl", division: "North" },
  { pattern: /west(?:ern)?/i, sport: "hockey/nhl",     division: "Western" },
  { pattern: /east(?:ern)?/i, sport: "hockey/nhl",     division: "Eastern" },
];

export function detectDivision(message: string): { sport: TeamEntry["sport"]; division: string } | null {
  for (const entry of DIVISION_LOOKUP) {
    if (entry.pattern.test(message)) {
      return { sport: entry.sport, division: entry.division };
    }
  }
  return null;
}

// ── New ESPN fetch functions ───────────────────────────────────────────────────

// Look up the most recent (or live) score for a team, scanning back up to daysBack days.
export async function getScore(team: TeamEntry, daysBack = 1): Promise<ScoreResult | null> {
  const now = new Date();
  for (let i = 0; i < daysBack; i++) {
    const d = new Date(now.getTime() - i * 86400000);
    const stamp = d.toLocaleDateString("en-CA", { timeZone: USER_TIMEZONE }).replace(/-/g, "");
    const url = `https://site.api.espn.com/apis/site/v2/sports/${team.sport}/scoreboard?dates=${stamp}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json() as { events?: ESPN_Event_Extended[] };
      for (const event of data.events ?? []) {
        const comp = event.competitions?.[0];
        if (!comp) continue;
        const match = comp.competitors?.find(
          (c) => c.team.abbreviation.toUpperCase() === team.abbr.toUpperCase()
        );
        if (!match) continue;
        const state = comp.status?.type?.state ?? "pre";
        if (state === "pre") continue; // skip upcoming games when looking for scores
        const home = comp.competitors?.find((c) => c.homeAway === "home");
        const away = comp.competitors?.find((c) => c.homeAway === "away");
        return {
          homeTeam: home?.team.displayName ?? "",
          awayTeam: away?.team.displayName ?? "",
          homeScore: parseInt(home?.score ?? "0", 10),
          awayScore: parseInt(away?.score ?? "0", 10),
          status: state as "pre" | "in" | "post",
          statusDetail: comp.status?.type?.detail ?? comp.status?.type?.shortDetail ?? "",
          date: event.date,
          venue: comp.venue?.fullName ?? "",
        };
      }
    } catch {
      // network error — try next day
    }
  }
  return null;
}

// Fetch the next numGames upcoming games for a team.
export async function getSchedule(team: TeamEntry, numGames = 5): Promise<ScheduleGame[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${team.sport}/teams/${team.teamId}/schedule`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json() as { events?: ESPN_ScheduleEvent[] };
    const upcoming: ScheduleGame[] = [];
    const now = Date.now();
    for (const event of data.events ?? []) {
      const state = event.competitions?.[0]?.status?.type?.state ?? "pre";
      if (state === "post") continue;
      if (new Date(event.date).getTime() < now - 3600000) continue; // skip games that ended > 1hr ago
      const comp = event.competitions?.[0];
      const myTeam = comp?.competitors?.find(
        (c) => c.team.id === team.teamId
      );
      const opponent = comp?.competitors?.find(
        (c) => c.team.id !== team.teamId
      );
      upcoming.push({
        date: event.date,
        startLocal: utcToLocalStamp(event.date),
        opponent: opponent?.team.displayName ?? "TBD",
        homeAway: (myTeam?.homeAway ?? "home") as "home" | "away",
        venue: comp?.venue?.fullName ?? "",
        status: state as "pre" | "in" | "post",
      });
      if (upcoming.length >= numGames) break;
    }
    return upcoming;
  } catch {
    return [];
  }
}

// Fetch the full season schedule for a team (all games regardless of status).
export async function getBulkSchedule(team: TeamEntry): Promise<ScheduleGame[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${team.sport}/teams/${team.teamId}/schedule`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json() as { events?: ESPN_ScheduleEvent[] };
    return (data.events ?? []).map((event) => {
      const comp = event.competitions?.[0];
      const myTeam = comp?.competitors?.find((c) => c.team.id === team.teamId);
      const opponent = comp?.competitors?.find((c) => c.team.id !== team.teamId);
      const state = comp?.status?.type?.state ?? "pre";
      return {
        date: event.date,
        startLocal: utcToLocalStamp(event.date),
        opponent: opponent?.team.displayName ?? "TBD",
        homeAway: (myTeam?.homeAway ?? "home") as "home" | "away",
        venue: comp?.venue?.fullName ?? "",
        status: state as "pre" | "in" | "post",
      };
    });
  } catch {
    return [];
  }
}

// Fetch standings for a sport, optionally filtered to a division.
export async function getStandings(
  sport: TeamEntry["sport"],
  division?: string
): Promise<StandingsEntry[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/standings`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json() as { children?: ESPN_StandingsGroup[] };
    const results: StandingsEntry[] = [];
    for (const group of data.children ?? []) {
      const divName = group.name ?? group.abbreviation ?? "";
      if (division && !divName.toLowerCase().includes(division.toLowerCase())) continue;
      for (const entry of group.standings?.entries ?? []) {
        const stats = Object.fromEntries(
          (entry.stats ?? []).map((s) => [s.name, s.displayValue])
        );
        results.push({
          teamName: entry.team?.displayName ?? "",
          wins: parseInt(stats["wins"] ?? stats["W"] ?? "0", 10),
          losses: parseInt(stats["losses"] ?? stats["L"] ?? "0", 10),
          winPct: stats["winPercent"] ?? stats["PCT"] ?? ".000",
          gamesBehind: stats["gamesBehind"] ?? stats["GB"] ?? "-",
          division: divName,
        });
      }
    }
    // Sort by win percentage descending
    results.sort((a, b) => parseFloat(b.winPct) - parseFloat(a.winPct));
    return results;
  } catch {
    return [];
  }
}

// Search for a player by name and return their current season stats.
export async function getPlayerStats(
  playerName: string,
  sport: TeamEntry["sport"]
): Promise<PlayerStatsResult | null> {
  const searchUrl = `https://site.api.espn.com/apis/site/v2/sports/${sport}/athletes?limit=10&search=${encodeURIComponent(playerName)}`;
  try {
    const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(8000) });
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json() as { items?: ESPN_Athlete[] };
    const athlete = searchData.items?.[0];
    if (!athlete) return null;

    const statsUrl = `https://site.api.espn.com/apis/site/v2/sports/${sport}/athletes/${athlete.id}/statistics`;
    const statsRes = await fetch(statsUrl, { signal: AbortSignal.timeout(8000) });
    if (!statsRes.ok) return null;
    const statsData = await statsRes.json() as { athlete?: { fullName?: string; team?: { displayName?: string }; position?: { displayName?: string } }; stats?: ESPN_StatCategory[] };

    // Extract the most relevant stat category for each sport
    const relevantCategory = getRelevantStatCategory(sport, statsData.stats ?? []);
    const stats: Record<string, string> = {};
    for (const stat of relevantCategory?.stats ?? []) {
      stats[stat.name] = stat.displayValue;
    }

    return {
      name: statsData.athlete?.fullName ?? athlete.fullName,
      team: statsData.athlete?.team?.displayName ?? "",
      position: statsData.athlete?.position?.displayName ?? "",
      stats,
      season: relevantCategory?.season ?? new Date().getFullYear().toString(),
    };
  } catch {
    return null;
  }
}

function getRelevantStatCategory(sport: TeamEntry["sport"], categories: ESPN_StatCategory[]) {
  // Pick the most informative category per sport
  const preferred: Record<string, string[]> = {
    "baseball/mlb":    ["Batting", "Pitching"],
    "basketball/nba":  ["General"],
    "football/nfl":    ["Passing", "Rushing", "Receiving"],
    "hockey/nhl":      ["Scoring"],
  };
  const prefs = preferred[sport] ?? [];
  for (const pref of prefs) {
    const found = categories.find((c) => c.name?.includes(pref));
    if (found) return found;
  }
  return categories[0] ?? null;
}

// ESPN response types (minimal)
interface ESPN_Event {
  date: string;
  competitions?: {
    competitors?: { homeAway: "home" | "away"; team: { abbreviation: string; displayName: string } }[];
    venue?: { fullName: string };
  }[];
}

interface ESPN_Event_Extended {
  date: string;
  competitions?: {
    competitors?: {
      homeAway: "home" | "away";
      score?: string;
      team: { abbreviation: string; displayName: string };
    }[];
    venue?: { fullName: string };
    status?: { type?: { state?: string; detail?: string; shortDetail?: string } };
  }[];
}

interface ESPN_ScheduleEvent {
  date: string;
  competitions?: {
    competitors?: {
      homeAway: "home" | "away";
      team: { id: string; displayName: string };
    }[];
    venue?: { fullName: string };
    status?: { type?: { state?: string } };
  }[];
}

interface ESPN_StandingsGroup {
  name?: string;
  abbreviation?: string;
  standings?: {
    entries?: {
      team?: { displayName?: string };
      stats?: { name: string; displayValue: string }[];
    }[];
  };
}

interface ESPN_Athlete {
  id: string;
  fullName: string;
}

interface ESPN_StatCategory {
  name?: string;
  season?: string;
  stats?: { name: string; displayValue: string }[];
}
