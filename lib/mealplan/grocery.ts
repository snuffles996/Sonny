// Grocery list builder: parses recipe ingredients, scales by servings,
// normalizes units, combines duplicate ingredients, and categorizes.

import { getAnthropicClient, FAST_MODEL } from "@/lib/anthropic/client";
import type { Recipe } from "@/lib/recipes/types";
import type { PlannedMeal } from "./types";

export type FoodCategory =
  | "Produce"
  | "Proteins"
  | "Dairy & Eggs"
  | "Pantry & Dry Goods"
  | "Canned & Jarred"
  | "Frozen"
  | "Beverages"
  | "Other";

export interface GroceryItem {
  name: string;
  displayQty: string;
  category: FoodCategory;
  sourceRecipes: string[];
  hasMultipleSources: boolean;
}

// ── Unit normalization tables ─────────────────────────────────────────────────

const UNIT_ALIASES: Record<string, string> = {
  tablespoon: "tbsp", tablespoons: "tbsp", tbsps: "tbsp",
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
  thumb: "thumb", thumbs: "thumb",
  knob: "knob", knobs: "knob",
  dash: "dash", dashes: "dash",
  splash: "splash",
};

const FOLK_UNITS = new Set([
  "thumb", "knob", "handful", "bunch", "sprig", "pinch",
  "dash", "splash",
]);

// Conversion to a common base unit (ml for volume, g for weight)
const VOLUME_TO_ML: Record<string, number> = {
  tsp: 5, tbsp: 15, cup: 240, ml: 1, l: 1000,
};

const WEIGHT_TO_G: Record<string, number> = {
  g: 1, kg: 1000, oz: 28.35, lb: 453.6,
};

// ── Static ingredient category lookup ────────────────────────────────────────

const INGREDIENT_CATEGORIES: Record<string, FoodCategory> = {
  // Produce
  garlic: "Produce", onion: "Produce", onions: "Produce", tomato: "Produce", tomatoes: "Produce",
  lemon: "Produce", lemons: "Produce", lime: "Produce", limes: "Produce",
  ginger: "Produce", carrot: "Produce", carrots: "Produce", celery: "Produce",
  spinach: "Produce", kale: "Produce", lettuce: "Produce", arugula: "Produce",
  "bell pepper": "Produce", zucchini: "Produce", cucumber: "Produce", broccoli: "Produce",
  mushroom: "Produce", mushrooms: "Produce", avocado: "Produce", avocados: "Produce",
  potato: "Produce", potatoes: "Produce", "sweet potato": "Produce",
  apple: "Produce", apples: "Produce", banana: "Produce", bananas: "Produce",
  strawberry: "Produce", strawberries: "Produce", blueberry: "Produce", blueberries: "Produce",
  mango: "Produce", mangoes: "Produce", cilantro: "Produce", parsley: "Produce",
  basil: "Produce", thyme: "Produce", rosemary: "Produce", mint: "Produce",
  scallion: "Produce", scallions: "Produce", shallot: "Produce", shallots: "Produce",
  jalapeño: "Produce", jalapeno: "Produce", corn: "Produce", asparagus: "Produce",
  // Proteins
  chicken: "Proteins", beef: "Proteins", pork: "Proteins", lamb: "Proteins",
  salmon: "Proteins", tuna: "Proteins", shrimp: "Proteins", tofu: "Proteins",
  tempeh: "Proteins", eggs: "Proteins", egg: "Proteins", turkey: "Proteins",
  bacon: "Proteins", sausage: "Proteins", steak: "Proteins", cod: "Proteins",
  tilapia: "Proteins", "ground beef": "Proteins", "ground turkey": "Proteins",
  // Dairy & Eggs
  milk: "Dairy & Eggs", butter: "Dairy & Eggs", cheese: "Dairy & Eggs",
  cream: "Dairy & Eggs", yogurt: "Dairy & Eggs", "heavy cream": "Dairy & Eggs",
  "sour cream": "Dairy & Eggs", "cream cheese": "Dairy & Eggs",
  parmesan: "Dairy & Eggs", mozzarella: "Dairy & Eggs", cheddar: "Dairy & Eggs",
  feta: "Dairy & Eggs", ricotta: "Dairy & Eggs", "half and half": "Dairy & Eggs",
  // Pantry & Dry Goods
  flour: "Pantry & Dry Goods", sugar: "Pantry & Dry Goods", salt: "Pantry & Dry Goods",
  pepper: "Pantry & Dry Goods", "black pepper": "Pantry & Dry Goods",
  "olive oil": "Pantry & Dry Goods", oil: "Pantry & Dry Goods",
  "vegetable oil": "Pantry & Dry Goods", "sesame oil": "Pantry & Dry Goods",
  rice: "Pantry & Dry Goods", pasta: "Pantry & Dry Goods", bread: "Pantry & Dry Goods",
  "soy sauce": "Pantry & Dry Goods", vinegar: "Pantry & Dry Goods",
  "balsamic vinegar": "Pantry & Dry Goods", "rice vinegar": "Pantry & Dry Goods",
  honey: "Pantry & Dry Goods", "maple syrup": "Pantry & Dry Goods",
  cumin: "Pantry & Dry Goods", paprika: "Pantry & Dry Goods", oregano: "Pantry & Dry Goods",
  "chili powder": "Pantry & Dry Goods", "garlic powder": "Pantry & Dry Goods",
  "onion powder": "Pantry & Dry Goods", "cayenne pepper": "Pantry & Dry Goods",
  "baking soda": "Pantry & Dry Goods", "baking powder": "Pantry & Dry Goods",
  "bread crumbs": "Pantry & Dry Goods", panko: "Pantry & Dry Goods",
  quinoa: "Pantry & Dry Goods", oats: "Pantry & Dry Goods", noodles: "Pantry & Dry Goods",
  // Canned & Jarred
  "chicken broth": "Canned & Jarred", "vegetable broth": "Canned & Jarred",
  "beef broth": "Canned & Jarred", broth: "Canned & Jarred", stock: "Canned & Jarred",
  "diced tomatoes": "Canned & Jarred", "tomato paste": "Canned & Jarred",
  "tomato sauce": "Canned & Jarred", "coconut milk": "Canned & Jarred",
  "black beans": "Canned & Jarred", "chickpeas": "Canned & Jarred",
  "kidney beans": "Canned & Jarred", lentils: "Canned & Jarred",
  // Frozen
  "frozen peas": "Frozen", "frozen corn": "Frozen",
};

// ── Ingredient line parser ─────────────────────────────────────────────────────

interface ParsedIngredient {
  qty: number | null;
  unit: string | null;
  isFolkUnit: boolean;
  name: string;
  recipeSlug: string;
  recipeName: string;
}

function parseFraction(s: string): number {
  // Handle "1/2", "1 1/2" etc.
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return parseInt(frac[1]) / parseInt(frac[2]);
  return parseFloat(s);
}

function parseIngredientLine(line: string, recipeSlug: string, recipeName: string): ParsedIngredient {
  // Strip leading "- " bullet
  const cleaned = line.replace(/^[-*•]\s*/, "").trim();

  // Patterns: "2 cups flour", "1/2 tsp salt", "3 large eggs", "1 thumb ginger", "salt to taste"
  // Match: optional quantity, optional unit, rest is name
  const match = cleaned.match(
    /^((?:\d+\s+)?\d+(?:[./]\d+)?)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)\s+(.+)$/
  );

  if (match) {
    const qty = parseFraction(match[1]);
    const rawUnit = match[2].toLowerCase();
    const normalized = UNIT_ALIASES[rawUnit] ?? rawUnit;
    const name = match[3].trim().toLowerCase().replace(/,$/, "");
    const isFolkUnit = FOLK_UNITS.has(normalized);
    // If the "unit" is actually an adjective like "large", "small", treat it as part of the name
    const adjectives = new Set(["large", "medium", "small", "fresh", "whole", "dried", "chopped", "minced", "sliced", "diced"]);
    if (adjectives.has(rawUnit)) {
      return { qty, unit: null, isFolkUnit: false, name: `${rawUnit} ${name}`, recipeSlug, recipeName };
    }
    return { qty, unit: normalized, isFolkUnit, name, recipeSlug, recipeName };
  }

  // No parseable quantity — treat whole line as name
  return { qty: null, unit: null, isFolkUnit: false, name: cleaned.toLowerCase(), recipeSlug, recipeName };
}

// ── Quantity display formatter ─────────────────────────────────────────────────

function formatQty(qty: number, unit: string | null): string {
  const rounded = Math.round(qty * 100) / 100;
  if (!unit) return String(rounded);
  // Convert to human-friendly fractions for small quantities
  const fractions: [number, string][] = [[0.25, "¼"], [0.33, "⅓"], [0.5, "½"], [0.67, "⅔"], [0.75, "¾"]];
  const whole = Math.floor(rounded);
  const decimal = rounded - whole;
  const frac = fractions.find(([v]) => Math.abs(decimal - v) < 0.04);
  const qtyStr = frac ? (whole > 0 ? `${whole} ${frac[1]}` : frac[1]) : String(rounded);
  return `${qtyStr} ${unit}`;
}

// ── Unit combination ──────────────────────────────────────────────────────────

interface CombinedQty {
  standard: number | null;  // in base unit (ml or g)
  standardUnit: "ml" | "g" | null;
  folk: string[];           // e.g. ["1 thumb", "2 thumbs"]
  unitless: number | null;  // count when no unit
}

function combineIngredient(items: ParsedIngredient[], planServings: number, recipeServings: Record<string, number>): { displayQty: string } {
  const combined: CombinedQty = { standard: null, standardUnit: null, folk: [], unitless: null };

  for (const item of items) {
    const recipeDefaultServings = recipeServings[item.recipeSlug] ?? planServings;
    const scaleFactor = recipeDefaultServings > 0 ? planServings / recipeDefaultServings : 1;
    const scaledQty = item.qty !== null ? item.qty * scaleFactor : null;

    if (item.isFolkUnit && item.unit && scaledQty !== null) {
      combined.folk.push(`${formatQty(scaledQty, item.unit)}`);
    } else if (item.unit && VOLUME_TO_ML[item.unit] !== undefined) {
      const inML = (scaledQty ?? 0) * VOLUME_TO_ML[item.unit];
      if (combined.standardUnit === "g") {
        combined.folk.push(scaledQty !== null ? formatQty(scaledQty, item.unit) : item.unit);
      } else {
        combined.standard = (combined.standard ?? 0) + inML;
        combined.standardUnit = "ml";
      }
    } else if (item.unit && WEIGHT_TO_G[item.unit] !== undefined) {
      const inG = (scaledQty ?? 0) * WEIGHT_TO_G[item.unit];
      if (combined.standardUnit === "ml") {
        combined.folk.push(scaledQty !== null ? formatQty(scaledQty, item.unit) : item.unit);
      } else {
        combined.standard = (combined.standard ?? 0) + inG;
        combined.standardUnit = "g";
      }
    } else if (scaledQty !== null && !item.unit) {
      combined.unitless = (combined.unitless ?? 0) + scaledQty;
    } else if (scaledQty !== null && item.unit) {
      // Unknown unit — treat as folk
      combined.folk.push(formatQty(scaledQty, item.unit));
    }
  }

  const parts: string[] = [];

  if (combined.standard !== null && combined.standardUnit === "ml") {
    // Convert ml back to largest sensible imperial unit
    const ml = combined.standard;
    if (ml >= 960) parts.push(formatQty(ml / 240, "cup"));
    else if (ml >= 30) parts.push(formatQty(ml / 240, "cup"));
    else if (ml >= 15) parts.push(formatQty(ml / 15, "tbsp"));
    else parts.push(formatQty(ml / 5, "tsp"));
  } else if (combined.standard !== null && combined.standardUnit === "g") {
    const g = combined.standard;
    if (g >= 453.6) parts.push(formatQty(g / 453.6, "lb"));
    else parts.push(formatQty(g / 28.35, "oz"));
  }

  if (combined.unitless !== null) {
    parts.push(String(Math.round(combined.unitless * 10) / 10));
  }

  parts.push(...combined.folk);

  return { displayQty: parts.join(" + ") || "as needed" };
}

// ── Categorization ────────────────────────────────────────────────────────────

async function categorizeIngredients(names: string[]): Promise<Record<string, FoodCategory>> {
  const result: Record<string, FoodCategory> = {};
  const unknown: string[] = [];

  for (const name of names) {
    // Try static lookup with progressively shorter prefixes
    const lower = name.toLowerCase();
    let found: FoodCategory | undefined;
    for (const [key, cat] of Object.entries(INGREDIENT_CATEGORIES)) {
      if (lower.includes(key)) { found = cat; break; }
    }
    if (found) result[name] = found;
    else unknown.push(name);
  }

  if (unknown.length === 0) return result;

  // Batch classify unknowns with Haiku
  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: FAST_MODEL,
      max_tokens: 512,
      system: `Categorize grocery ingredients into one of: Produce, Proteins, Dairy & Eggs, Pantry & Dry Goods, Canned & Jarred, Frozen, Beverages, Other`,
      messages: [{ role: "user", content: `Categorize these ingredients (JSON object mapping name to category):\n${unknown.join(", ")}` }],
      tools: [
        {
          name: "categorize",
          description: "Return category for each ingredient",
          input_schema: {
            type: "object" as const,
            properties: {
              categories: {
                type: "object",
                additionalProperties: { type: "string" },
              },
            },
            required: ["categories"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "categorize" },
    });
    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (toolUse && toolUse.type === "tool_use") {
      const input = toolUse.input as { categories: Record<string, string> };
      for (const [name, cat] of Object.entries(input.categories)) {
        result[name] = cat as FoodCategory;
      }
    }
  } catch { /* fallback to Other */ }

  for (const name of unknown) {
    if (!result[name]) result[name] = "Other";
  }
  return result;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function buildGroceryList(
  meals: PlannedMeal[],
  recipes: Recipe[],
  planServings: number
): Promise<GroceryItem[]> {
  const recipeBySlug = new Map(recipes.map((r) => [r.slug, r]));

  // Build servings map for scaling
  const recipeServings: Record<string, number> = {};
  for (const meal of meals) {
    const recipe = recipeBySlug.get(meal.recipeSlug);
    if (recipe?.servings) recipeServings[meal.recipeSlug] = recipe.servings;
  }

  // Parse all ingredients from all meals
  const allIngredients: ParsedIngredient[] = [];
  for (const meal of meals) {
    const recipe = recipeBySlug.get(meal.recipeSlug);
    if (!recipe) continue;

    // Extract the ## Ingredients section from the content markdown
    const ingredientsMatch = recipe.content.match(/##\s*Ingredients\s*\n([\s\S]*?)(?:\n##|\s*$)/i);
    if (!ingredientsMatch) continue;

    const lines = ingredientsMatch[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("-") || l.startsWith("*") || l.startsWith("•"));

    for (const line of lines) {
      allIngredients.push(parseIngredientLine(line, meal.recipeSlug, meal.recipeName));
    }
  }

  // Group by normalized ingredient name
  const groups = new Map<string, ParsedIngredient[]>();
  for (const ingredient of allIngredients) {
    const key = ingredient.name.trim().toLowerCase().replace(/\s+/g, " ");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(ingredient);
  }

  // Categorize all ingredient names
  const names = Array.from(groups.keys());
  const categories = await categorizeIngredients(names);

  // Build final list
  const items: GroceryItem[] = [];
  for (const [name, group] of Array.from(groups)) {
    const sourceRecipes = Array.from(new Set(group.map((g) => g.recipeName)));
    const { displayQty } = combineIngredient(group, planServings, recipeServings);
    items.push({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      displayQty,
      category: categories[name] ?? "Other",
      sourceRecipes,
      hasMultipleSources: sourceRecipes.length > 1,
    });
  }

  // Sort alphabetically within each category
  items.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.name.localeCompare(b.name);
  });

  return items;
}

export function formatGroceryListText(items: GroceryItem[]): string {
  const byCategory = new Map<FoodCategory, GroceryItem[]>();
  for (const item of items) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category)!.push(item);
  }

  const sections: string[] = [];
  for (const [category, catItems] of Array.from(byCategory)) {
    const lines = catItems.map((item) => {
      const source = item.hasMultipleSources
        ? `_(${item.sourceRecipes.length} recipes)_`
        : `_${item.sourceRecipes[0]}_`;
      return `• **${item.name}** — ${item.displayQty}  ${source}`;
    });
    sections.push(`**${category}**\n${lines.join("\n")}`);
  }
  return sections.join("\n\n");
}
