#!/usr/bin/env node
// Syncs your Audible library into the structured Redis book store
// (library:kevin:books). Re-run after new purchases.
//
// Prerequisites (first time only — run in Terminal.app, needs interactive input):
//   /Users/Kevin/Library/Python/3.9/bin/audible-quickstart
//
// Export library (run in Terminal.app):
//   python3 scripts/fetch-audible-library.py > library.json
//
// Usage:
//   KV_REST_API_URL=... KV_REST_API_TOKEN=... node scripts/sync-audible.mjs library.json
//
// Or pipe env from .env.local:
//   export $(grep -E 'KV_REST' .env.local | tr -d '"') && node scripts/sync-audible.mjs library.json

import { readFileSync } from "fs";
import { Redis } from "@upstash/redis";

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const USER_ID = process.env.AUDIBLE_USER_ID ?? "kevin";

if (!KV_URL || !KV_TOKEN) {
  console.error("Error: KV_REST_API_URL and KV_REST_API_TOKEN are required");
  process.exit(1);
}

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node scripts/sync-audible.mjs <path-to-library.json>");
  process.exit(1);
}

const redis = new Redis({ url: KV_URL, token: KV_TOKEN });
const REDIS_KEY = `library:${USER_ID}:books`;

function makeId(asin) {
  return `audible-${asin}`;
}

function parseSeries(book) {
  if (!book.series) return { series: undefined, seriesPosition: undefined };
  const first = Array.isArray(book.series) ? book.series[0] : null;
  if (!first) return { series: undefined, seriesPosition: undefined };
  if (typeof first === "string") return { series: first, seriesPosition: undefined };
  return {
    series: first.title ?? first.name ?? String(first),
    seriesPosition: first.position != null ? Number(first.position) : undefined,
  };
}

// Google Books API — free, no key required for basic usage
async function fetchGoogleBooksCover(title, author) {
  try {
    const q = encodeURIComponent(`intitle:${title} inauthor:${author}`);
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=1&printType=books&langRestrict=en`
    );
    if (!res.ok) return undefined;
    const data = await res.json();
    const info = data.items?.[0]?.volumeInfo;
    const thumb = info?.imageLinks?.thumbnail ?? info?.imageLinks?.smallThumbnail;
    return thumb ? thumb.replace("http://", "https://") : undefined;
  } catch {
    return undefined;
  }
}

// Fetch cover URLs in parallel batches to avoid overwhelming the API
async function enrichCoversInBatches(books, batchSize = 8) {
  let enriched = 0;
  for (let i = 0; i < books.length; i += batchSize) {
    const batch = books.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (book) => {
        const cover = await fetchGoogleBooksCover(book.title, book.author);
        if (cover) { book.coverUrl = cover; enriched++; }
      })
    );
    process.stdout.write(`\r  Fetching covers... ${Math.min(i + batchSize, books.length)}/${books.length}`);
  }
  process.stdout.write("\n");
  return enriched;
}

async function main() {
  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  const books = Array.isArray(raw) ? raw : (raw.library ?? Object.values(raw));
  console.log(`Found ${books.length} books in ${filePath}`);

  // Load existing library
  const existing = (await redis.get(REDIS_KEY)) ?? [];
  const byAsin = new Map(existing.map((b) => [b.audibleAsin, b]));

  let added = 0;
  let updated = 0;
  const newBooks = [];

  for (const book of books) {
    const asin = book.asin;
    if (!asin) continue;

    const now = new Date().toISOString();
    const { series, seriesPosition } = parseSeries(book);

    if (byAsin.has(asin)) {
      // Update existing record — never overwrite user-set fields
      const rec = byAsin.get(asin);
      byAsin.set(asin, { ...rec, lastSyncedAt: now });
      updated++;
    } else {
      const authorStr = Array.isArray(book.authors)
        ? book.authors.join(", ")
        : (book.authors ?? "Unknown");
      const newBook = {
        id: makeId(asin),
        title: book.title ?? "Unknown",
        author: authorStr,
        series,
        seriesPosition,
        audibleAsin: asin,
        status: "shelf",
        source: "audible",
        coverUrl: undefined,
        dateAdded: book.purchase_date?.slice(0, 10) ?? now.slice(0, 10),
        lastSyncedAt: now,
      };
      byAsin.set(asin, newBook);
      newBooks.push(newBook);
      added++;
    }
  }

  // Also backfill covers for existing books that don't have one
  const missingCover = Array.from(byAsin.values()).filter((b) => !b.coverUrl);
  const toEnrich = missingCover;

  if (toEnrich.length > 0) {
    console.log(`Fetching Google Books covers for ${toEnrich.length} books...`);
    const enriched = await enrichCoversInBatches(toEnrich);
    console.log(`  Covers found: ${enriched}/${toEnrich.length}`);
  }

  const finalLibrary = Array.from(byAsin.values());
  await redis.set(REDIS_KEY, finalLibrary);

  console.log(`\nDone! Added: ${added}, Updated: ${updated}, Total: ${finalLibrary.length}`);
  console.log(`Redis key: ${REDIS_KEY}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
