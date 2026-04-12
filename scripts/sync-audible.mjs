#!/usr/bin/env node
// One-time script to seed your Audible library into Pinecone.
//
// Prerequisites:
//   pip install audible-cli
//   audible-cli quickstart          # log in to your Audible account
//   audible library export --format json --output library.json
//
// Usage:
//   node scripts/sync-audible.mjs library.json
//
// Re-run whenever you make new purchases.
// Uses Pinecone integrated inference (llama-text-embed-v2) — no OpenAI key needed.

import { readFileSync } from "fs";
import { Pinecone } from "@pinecone-database/pinecone";

const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX = process.env.PINECONE_INDEX_NAME ?? "sonny";
const NAMESPACE = "kevin-audible";
const EMBED_MODEL = "llama-text-embed-v2";

if (!PINECONE_API_KEY) {
  console.error("Error: PINECONE_API_KEY environment variable is required");
  process.exit(1);
}

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node scripts/sync-audible.mjs <path-to-library.json>");
  process.exit(1);
}

async function embedTexts(texts) {
  const res = await fetch("https://api.pinecone.io/embed", {
    method: "POST",
    headers: {
      "Api-Key": PINECONE_API_KEY,
      "Content-Type": "application/json",
      "X-Pinecone-API-Version": "2025-04",
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      inputs: texts.map((text) => ({ text })),
      parameters: { input_type: "passage" },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Pinecone embed failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  return data.data.map((d) => d.values);
}

async function main() {
  const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
  const index = pinecone.index(PINECONE_INDEX);

  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  const books = Array.isArray(raw) ? raw : raw.library ?? Object.values(raw);

  console.log(`Found ${books.length} books in library.json`);

  const BATCH_SIZE = 10;
  let synced = 0;
  let skipped = 0;

  for (let i = 0; i < books.length; i += BATCH_SIZE) {
    const batch = books.slice(i, i + BATCH_SIZE);

    const texts = batch.map((book) =>
      [
        book.title,
        book.authors?.join(", "),
        book.publisher,
        book.merchandising_summary,
        book.publisher_summary,
        book.categories?.join(", "),
        book.series?.join(", "),
      ]
        .filter(Boolean)
        .join(" | ")
    );

    let vectors;
    try {
      vectors = await embedTexts(texts);
    } catch (err) {
      console.error(`Embed failed for batch ${i}–${i + BATCH_SIZE}:`, err.message);
      skipped += batch.length;
      continue;
    }

    const records = batch.map((book, idx) => ({
      id: book.asin ?? `book-${i + idx}`,
      values: vectors[idx],
      metadata: {
        asin: book.asin ?? "",
        title: book.title ?? "",
        authors: book.authors?.join(", ") ?? "",
        narrator: book.narrators?.join(", ") ?? "",
        runtime_minutes: book.runtime_length_min ?? 0,
        purchase_date: book.purchase_date ?? "",
        series: book.series?.join(", ") ?? "",
        summary: ((book.merchandising_summary ?? book.publisher_summary ?? "")).slice(0, 500),
        audible_url: book.asin ? `https://www.audible.com/pd/${book.asin}` : "",
      },
    }));

    await index.namespace(NAMESPACE).upsert({ records });
    synced += batch.length;
    console.log(`Synced ${synced}/${books.length}...`);
  }

  console.log(`\nDone! Synced: ${synced}, Skipped: ${skipped}`);
  console.log(`Namespace: ${NAMESPACE}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
