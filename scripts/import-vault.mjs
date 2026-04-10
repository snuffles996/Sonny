// One-time import: seeds Pinecone from the Obsidian vault and sets Kevin's Redis profile.
// Run from repo root: node scripts/import-vault.mjs
//
// What this imports:
//   kevin-notes:    memory.md, open-loops.md, birthdays, watchlist, journal entries
//   shared-recipes: all recipe files + recipe list table

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import { Pinecone } from "@pinecone-database/pinecone";
import { Redis } from "@upstash/redis";

// ---------------------------------------------------------------------------
// Load .env.local
// ---------------------------------------------------------------------------
function loadEnv(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    console.warn(`Could not read ${filePath} — falling back to existing env`);
    return;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv(".env.local");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const VAULT =
  "/Users/Kevin/Library/Mobile Documents/iCloud~md~obsidian/Documents/PersonalAI";

const EMBED_MODEL = "llama-text-embed-v2";
const EMBED_BATCH = 10; // max texts per embed call

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.index(process.env.PINECONE_INDEX_NAME ?? "sonny");

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function read(path) {
  return readFileSync(path, "utf8").trim();
}

function stripFrontmatter(text) {
  if (!text.startsWith("---")) return text;
  const end = text.indexOf("\n---", 3);
  return end < 0 ? text : text.slice(end + 4).trim();
}

async function embed(texts) {
  const res = await fetch("https://api.pinecone.io/embed", {
    method: "POST",
    headers: {
      "Api-Key": process.env.PINECONE_API_KEY,
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
    const body = await res.text();
    throw new Error(`Embed failed ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.data.map((d) => d.values);
}

async function upsert(namespace, chunks) {
  // chunks: [{ text, metadata }]
  // Process in batches so we don't overwhelm the embed API
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const vectors = await embed(batch.map((c) => c.text));
    const records = batch.map((c, j) => ({
      id: crypto.randomUUID(),
      values: vectors[j],
      metadata: { ...c.metadata, text: c.text },
    }));
    await index.namespace(namespace).upsert({ records });
    process.stdout.write(
      `  [${namespace}] +${records.length} (${i + records.length}/${chunks.length})\n`
    );
  }
}

// ---------------------------------------------------------------------------
// 1. Seed Kevin's Redis profile
// ---------------------------------------------------------------------------
async function seedProfile() {
  console.log("\n→ Seeding Kevin's profile in Redis...");
  const profile = {
    userId: "kevin",
    homeLocation: "San Diego, CA 92111",
    workLocation: "Apple (Optical Systems Engineer)",
    commuteCorridor: "",
    hobbiesAndInterests: [
      "training for San Diego Rock and Roll Half Marathon (May 31, 2026)",
      "cooking",
      "pickleball",
    ],
    dietaryPreferences: [],
    standingContext:
      "Wife: Kylie Parker (birthday May 21, 1990; married Jan 1 2022). " +
      "Dog: Tulip (born April-May 2020). Age: 34. " +
      "Communication style: direct and brief. Familiar with Claude Code and MCP. " +
      "Current focus: half marathon training; planning Kylie's birthday (May 21); " +
      "two Iowa family trips (May and August for nephew Teddy's birthday).",
    updatedAt: new Date().toISOString(),
  };
  await redis.set("profile:kevin", profile);
  console.log("  Done.");
}

// ---------------------------------------------------------------------------
// 2. Import vault files into Pinecone
// ---------------------------------------------------------------------------
async function importVault() {
  // --- kevin-notes ---

  console.log("\n→ memory.md → kevin-notes");
  await upsert("kevin-notes", [
    {
      text: read(join(VAULT, "memory.md")),
      metadata: { source: "memory.md", userId: "kevin", createdAt: Date.now() },
    },
  ]);

  console.log("\n→ open-loops.md → kevin-notes");
  await upsert("kevin-notes", [
    {
      text: `Open loops / active tasks:\n${read(join(VAULT, "open-loops.md"))}`,
      metadata: { source: "open-loops.md", userId: "kevin", createdAt: Date.now() },
    },
  ]);

  console.log("\n→ lists/birthdays.md → kevin-notes");
  await upsert("kevin-notes", [
    {
      text: read(join(VAULT, "lists/birthdays.md")),
      metadata: { source: "lists/birthdays.md", userId: "kevin", createdAt: Date.now() },
    },
  ]);

  console.log("\n→ lists/watchlist.md → kevin-notes");
  const watchlist = read(join(VAULT, "lists/watchlist.md"));
  if (watchlist) {
    await upsert("kevin-notes", [
      {
        text: watchlist,
        metadata: { source: "lists/watchlist.md", userId: "kevin", createdAt: Date.now() },
      },
    ]);
  }

  console.log("\n→ journal/ → kevin-notes");
  const journalFiles = readdirSync(join(VAULT, "journal")).filter((f) =>
    f.endsWith(".md")
  );
  const journalChunks = journalFiles
    .map((f) => {
      const text = read(join(VAULT, "journal", f));
      return text
        ? {
            text: `Journal (${f}):\n${text}`,
            metadata: { source: `journal/${f}`, userId: "kevin", createdAt: Date.now() },
          }
        : null;
    })
    .filter(Boolean);
  if (journalChunks.length) await upsert("kevin-notes", journalChunks);

  // --- shared-recipes ---

  console.log("\n→ lists/recipelist.md → shared-recipes");
  await upsert("shared-recipes", [
    {
      text: read(join(VAULT, "lists/recipelist.md")),
      metadata: { source: "lists/recipelist.md", type: "recipe-index", createdAt: Date.now() },
    },
  ]);

  console.log("\n→ recipes/*.md → shared-recipes");
  const recipeFiles = readdirSync(join(VAULT, "recipes")).filter((f) =>
    f.endsWith(".md")
  );
  const recipeChunks = recipeFiles
    .map((f) => {
      const raw = read(join(VAULT, "recipes", f));
      const text = stripFrontmatter(raw);
      return text
        ? {
            text,
            metadata: {
              source: `recipes/${f}`,
              name: f.replace(/-/g, " ").replace(".md", ""),
              type: "recipe",
              createdAt: Date.now(),
            },
          }
        : null;
    })
    .filter(Boolean);

  console.log(`  ${recipeChunks.length} recipe files found`);
  if (recipeChunks.length) await upsert("shared-recipes", recipeChunks);
}

// ---------------------------------------------------------------------------
// Seed structured recipe data into Redis (for the /recipes page)
// ---------------------------------------------------------------------------
async function seedRecipes() {
  console.log("\n→ Seeding structured recipes into Redis...");

  const recipesDir = join(VAULT, "recipes");
  const files = readdirSync(recipesDir).filter((f) => f.endsWith(".md"));

  const recipes = [];

  for (const file of files) {
    const raw = read(join(recipesDir, file));
    if (!raw.startsWith("---")) continue;

    const end = raw.indexOf("\n---\n", 4);
    if (end < 0) continue;

    const yamlStr = raw.slice(4, end);
    const body = raw.slice(end + 5).trim();

    let meta;
    try {
      meta = parseYaml(yamlStr);
    } catch {
      continue;
    }

    recipes.push({
      slug: meta.slug ?? file.replace(".md", ""),
      name: meta.name ?? file.replace(/-/g, " ").replace(".md", ""),
      cuisine: meta.cuisine ?? "",
      source: meta.source ?? "",
      url: meta.url ?? null,
      servings: meta.servings ?? null,
      totalTime: meta.total_time ?? null,
      content: body,
    });
  }

  await redis.set("data:recipes", recipes);
  console.log(`  ${recipes.length} recipes stored in Redis.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("Sonny — Vault Import");
  console.log("====================");
  console.log(`Vault: ${VAULT}`);
  console.log(`Index: ${process.env.PINECONE_INDEX_NAME ?? "sonny"}`);

  await seedProfile();
  await importVault();
  await seedRecipes();

  console.log("\n✓ Import complete.");
}

main().catch((err) => {
  console.error("\nImport failed:", err);
  process.exit(1);
});
