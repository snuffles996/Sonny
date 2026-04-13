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
  // audible-cli exports series as an array of objects or strings
  const first = Array.isArray(book.series) ? book.series[0] : null;
  if (!first) return { series: undefined, seriesPosition: undefined };
  if (typeof first === "string") return { series: first, seriesPosition: undefined };
  return {
    series: first.title ?? first.name ?? String(first),
    seriesPosition: first.position != null ? Number(first.position) : undefined,
  };
}

function inferStatus(book) {
  const pct = book.percent_complete ?? book.percentComplete;
  if (pct != null && Number(pct) >= 99) return "finished";
  return "shelf";
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

  for (const book of books) {
    const asin = book.asin;
    if (!asin) continue;

    const now = new Date().toISOString();
    const { series, seriesPosition } = parseSeries(book);
    const inferredStatus = inferStatus(book);

    if (byAsin.has(asin)) {
      // Update existing record — never overwrite user-set fields
      const existing = byAsin.get(asin);
      const updated_record = {
        ...existing,
        lastSyncedAt: now,
        // Only update status if user hasn't manually set it beyond "shelf"
        ...(existing.status === "shelf" && inferredStatus === "finished"
          ? { status: "finished", dateFinished: existing.dateFinished ?? now.slice(0, 10) }
          : {}),
      };
      byAsin.set(asin, updated_record);
      updated++;
    } else {
      // New record
      const newBook = {
        id: makeId(asin),
        title: book.title ?? "Unknown",
        author: Array.isArray(book.authors)
          ? book.authors.join(", ")
          : (book.authors ?? "Unknown"),
        series,
        seriesPosition,
        audibleAsin: asin,
        status: inferredStatus,
        source: "audible",
        coverUrl: book.cover_url ?? book.product_images?.["500"] ?? undefined,
        dateAdded: book.purchase_date?.slice(0, 10) ?? now.slice(0, 10),
        ...(inferredStatus === "finished"
          ? { dateFinished: now.slice(0, 10) }
          : {}),
        lastSyncedAt: now,
      };
      byAsin.set(asin, newBook);
      added++;
    }
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
