#!/usr/bin/env node
// One-time script to fetch ESPN team IDs for all 4 major sports.
// Run: node scripts/fetch-team-ids.mjs

const SPORTS = [
  "baseball/mlb",
  "football/nfl",
  "basketball/nba",
  "hockey/nhl",
];

async function fetchTeams(sport) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/teams?limit=50`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${sport}: HTTP ${res.status}`);
  const data = await res.json();
  const teams = data.sports?.[0]?.leagues?.[0]?.teams ?? [];
  return teams.map((t) => ({
    id: t.team.id,
    abbreviation: t.team.abbreviation,
    displayName: t.team.displayName,
    shortDisplayName: t.team.shortDisplayName,
  }));
}

async function main() {
  for (const sport of SPORTS) {
    console.log(`\n=== ${sport.toUpperCase()} ===`);
    const teams = await fetchTeams(sport);
    teams.sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));
    for (const t of teams) {
      console.log(`  ${t.abbreviation.padEnd(4)} → id: ${t.id.toString().padEnd(3)} (${t.displayName})`);
    }
  }
}

main().catch(console.error);
