#!/usr/bin/env node
// Normalizes unit names in recipe ingredient lines stored in Redis.
// Converts long-form units (tablespoons, ounces, etc.) to canonical short
// forms (tbsp, oz, etc.) so the grocery list parser can combine quantities
// correctly across recipes.
//
// Usage (from repo root):
//   KV_REST_API_URL="..." KV_REST_API_TOKEN="..." node scripts/normalize-recipe-units.mjs
//
// Dry-run mode (no writes):
//   ... node scripts/normalize-recipe-units.mjs --dry-run

import { Redis } from "@upstash/redis";

const DRY_RUN = process.argv.includes("--dry-run");

const UNIT_ALIASES = {
  tablespoon: "tbsp", tablespoons: "tbsp", tbsps: "tbsp", tb: "tbsp",
  teaspoon: "tsp", teaspoons: "tsp", tsps: "tsp",
  cup: "cup", cups: "cup",
  ounce: "oz", ounces: "oz",
  pound: "lb", pounds: "lb", lbs: "lb",
  gram: "g", grams: "g",
  kilogram: "kg", kilograms: "kg",
  milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml",
  liter: "l", liters: "l", litre: "l", litres: "l",
  clove: "clove", cloves: "clove",
  slice: "slice", slices: "slice",
  can: "can", cans: "can",
  piece: "piece", pieces: "piece",
  pinch: "pinch", pinches: "pinch",
  handful: "handful", handfuls: "handful",
  sprig: "sprig", sprigs: "sprig",
  bunch: "bunch", bunches: "bunch",
  strip: "strip", strips: "strip",
  fillet: "fillet", fillets: "fillet",
  stalk: "stalk", stalks: "stalk",
  head: "head", heads: "head",
};

// Matches ingredient lines: optional bullet, then qty unit name
// Captures the unit word to check against UNIT_ALIASES
const INGREDIENT_LINE_RE = /^([-*•]\s*)((?:\d+\s+)?\d+(?:[./]\d+)?)\s+([a-zA-Z]+\.?)\s+(.+)$/;

function normalizeLine(line) {
  const match = line.match(INGREDIENT_LINE_RE);
  if (!match) return { line, changed: false };

  const [, bullet, qty, rawUnit, rest] = match;
  const unitClean = rawUnit.replace(/\.$/, "").toLowerCase();
  const canonical = UNIT_ALIASES[unitClean];

  if (!canonical || canonical === unitClean) return { line, changed: false };

  const normalized = `${bullet}${qty} ${canonical} ${rest}`;
  return { line: normalized, changed: true };
}

function normalizeIngredientSection(content) {
  const lines = content.split("\n");
  let inIngredients = false;
  let changed = false;
  const changes = [];

  const result = lines.map((line) => {
    if (/^##\s*Ingredients/i.test(line)) { inIngredients = true; return line; }
    if (/^##\s/.test(line) && inIngredients) { inIngredients = false; return line; }

    if (inIngredients && (line.trim().startsWith("-") || line.trim().startsWith("*") || line.trim().startsWith("•"))) {
      const { line: normalized, changed: lineChanged } = normalizeLine(line.trim());
      if (lineChanged) {
        changes.push(`  "${line.trim()}" → "${normalized}"`);
        changed = true;
        return normalized;
      }
    }
    return line;
  });

  return { content: result.join("\n"), changed, changes };
}

async function main() {
  const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });

  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}\n`);

  const recipes = await redis.get("data:recipes");
  if (!recipes || !Array.isArray(recipes)) {
    console.error("No recipes found at data:recipes");
    process.exit(1);
  }

  console.log(`Loaded ${recipes.length} recipes.\n`);

  let totalChanged = 0;
  let totalLines = 0;
  const updated = recipes.map((recipe) => {
    const { content, changed, changes } = normalizeIngredientSection(recipe.content ?? "");
    if (changed) {
      totalChanged++;
      totalLines += changes.length;
      console.log(`✓ ${recipe.name} (${recipe.slug})`);
      changes.forEach((c) => console.log(c));
      console.log();
      return { ...recipe, content };
    }
    return recipe;
  });

  console.log(`\n${totalChanged} recipe(s) with ${totalLines} unit change(s).`);

  if (totalChanged === 0) {
    console.log("Nothing to update.");
    return;
  }

  if (DRY_RUN) {
    console.log("\nDry run — no changes written.");
  } else {
    await redis.set("data:recipes", updated);
    console.log("\nWritten back to Redis.");
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
