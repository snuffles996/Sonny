// Robust item save: always writes to Redis, optionally enriches via TMDB and
// saves an enriched note to Pinecone. Enrichment failures never block the save.

import { addItems } from "./store";
import { addToListIndex } from "./index";
import { categorizeItems } from "./categorize";
import { saveNote } from "@/lib/pinecone/records";
import { searchMoviesAndTV } from "@/lib/movies/search";
import type { UserId } from "@/lib/profile/types";

export interface AddItemPayload {
  userId: UserId;
  listName: string;
  itemName: string;
  itemType: string;
  knownMetadata?: Record<string, string>;
  enrichmentSource?: "tmdb" | "none";
}

export interface AddItemResult {
  success: true;
  savedTo: "redis" | "pinecone" | "both";
  enriched: boolean;
  reply: string;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
}

function titlesMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

// Lists where items are physical products — skip enrichment, keep categorize flow
const GROCERY_LIST_NAMES = new Set([
  "grocery", "groceries", "costco", "traderjoes", "target",
  "walmart", "safeway", "wholefoods", "kroger", "aldi",
]);

export function isGroceryList(listName: string): boolean {
  return GROCERY_LIST_NAMES.has(listName.toLowerCase().replace(/\s/g, ""));
}

// Which enrichment source to use based on the list name
export function enrichmentSourceForList(listName: string): "tmdb" | "none" {
  const name = listName.toLowerCase();
  if (["watchlist", "watch", "movies", "shows", "tv"].includes(name)) return "tmdb";
  return "none";
}

export async function addItemToList(payload: AddItemPayload): Promise<AddItemResult> {
  const {
    userId,
    listName,
    itemName,
    knownMetadata = {},
    enrichmentSource = "none",
  } = payload;

  const listLabel = listName.charAt(0).toUpperCase() + listName.slice(1);

  // 1. Always write to Redis — this is the reliable save
  await addItems(userId, listName, [itemName], categorizeItems);
  await addToListIndex(userId, listName);

  // 2. Attempt TMDB enrichment if requested
  if (enrichmentSource === "tmdb" && process.env.TMDB_API_KEY) {
    try {
      const results = await searchMoviesAndTV(itemName, 3);
      const match = results.find((r) => titlesMatch(r.title, itemName));

      if (match) {
        // Build enriched passage and save to Pinecone for future recall
        const parts = [
          `${listLabel} list: ${match.title}`,
          match.type === "tv" ? "TV series" : "Movie",
          match.overview ? match.overview.slice(0, 180) : "",
          match.releaseDate ? match.releaseDate.slice(0, 4) : "",
          match.genres.length ? match.genres.join(", ") : "",
          match.status && match.status !== "Released" ? match.status : "",
          match.seasons ? `${match.seasons} seasons` : "",
          ...Object.entries(knownMetadata).map(([k, v]) => `${k}: ${v}`),
        ].filter(Boolean);
        await saveNote(userId, parts.join(" — "));

        const typeLabel = match.type === "tv" ? "series" : "movie";
        const year = match.releaseDate ? ` (${match.releaseDate.slice(0, 4)})` : "";
        const genreNote = match.genres.length ? ` — ${match.genres.slice(0, 2).join(", ")}` : "";
        const statusNote =
          match.status && !["Released", "Returning Series"].includes(match.status)
            ? ` · ${match.status}`
            : "";

        return {
          success: true,
          savedTo: "both",
          enriched: true,
          reply: `Added **${match.title}**${year} to your ${listLabel} list. ${typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)}${genreNote}${statusNote}.`,
        };
      }
    } catch {
      // Enrichment failed — Redis write already succeeded, continue to fallback reply
    }
  }

  const failNote =
    enrichmentSource === "tmdb"
      ? " Couldn't find it in the movie database yet — probably too new."
      : "";

  return {
    success: true,
    savedTo: "redis",
    enriched: false,
    reply: `Added **${itemName}** to your ${listLabel} list.${failNote}`,
  };
}
