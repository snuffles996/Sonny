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
  thumb: "thumb", thumbs: "thumb",
  knob: "knob", knobs: "knob",
  dash: "dash", dashes: "dash",
  splash: "splash",
  stalk: "stalk", stalks: "stalk",
  head: "head", heads: "head",
  strip: "strip", strips: "strip",
  fillet: "fillet", fillets: "fillet",
};

const FOLK_UNITS = new Set([
  "thumb", "knob", "handful", "bunch", "sprig", "pinch",
  "dash", "splash",
]);

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
  cabbage: "Produce", cauliflower: "Produce", eggplant: "Produce", leek: "Produce", leeks: "Produce",
  radish: "Produce", radishes: "Produce", fennel: "Produce", artichoke: "Produce",
  // Proteins
  chicken: "Proteins", beef: "Proteins", pork: "Proteins", lamb: "Proteins",
  salmon: "Proteins", tuna: "Proteins", shrimp: "Proteins", tofu: "Proteins",
  tempeh: "Proteins", eggs: "Proteins", egg: "Proteins", turkey: "Proteins",
  bacon: "Proteins", sausage: "Proteins", steak: "Proteins", cod: "Proteins",
  tilapia: "Proteins", "ground beef": "Proteins", "ground turkey": "Proteins",
  "ground pork": "Proteins", halibut: "Proteins", scallops: "Proteins", crab: "Proteins",
  // Dairy & Eggs
  milk: "Dairy & Eggs",
  "heavy cream": "Dairy & Eggs", "heavy whipping cream": "Dairy & Eggs",
  "sour cream": "Dairy & Eggs", "cream cheese": "Dairy & Eggs",
  parmesan: "Dairy & Eggs", "parmesan cheese": "Dairy & Eggs",
  mozzarella: "Dairy & Eggs", "mozzarella cheese": "Dairy & Eggs",
  cheddar: "Dairy & Eggs", "cheddar cheese": "Dairy & Eggs",
  feta: "Dairy & Eggs", "feta cheese": "Dairy & Eggs",
  ricotta: "Dairy & Eggs", "ricotta cheese": "Dairy & Eggs",
  "half and half": "Dairy & Eggs",
  "greek yogurt": "Dairy & Eggs", yogurt: "Dairy & Eggs",
  "goat cheese": "Dairy & Eggs", "gruyere": "Dairy & Eggs",
  "cottage cheese": "Dairy & Eggs", "monterey jack": "Dairy & Eggs",
  // Pantry & Dry Goods
  rice: "Pantry & Dry Goods", pasta: "Pantry & Dry Goods", bread: "Pantry & Dry Goods",
  "soy sauce": "Pantry & Dry Goods", vinegar: "Pantry & Dry Goods",
  "balsamic vinegar": "Pantry & Dry Goods", "rice vinegar": "Pantry & Dry Goods",
  "apple cider vinegar": "Pantry & Dry Goods",
  honey: "Pantry & Dry Goods", "maple syrup": "Pantry & Dry Goods",
  "bread crumbs": "Pantry & Dry Goods", panko: "Pantry & Dry Goods",
  quinoa: "Pantry & Dry Goods", oats: "Pantry & Dry Goods", noodles: "Pantry & Dry Goods",
  "hot sauce": "Pantry & Dry Goods", "worcestershire sauce": "Pantry & Dry Goods",
  "fish sauce": "Pantry & Dry Goods", "oyster sauce": "Pantry & Dry Goods",
  "hoisin sauce": "Pantry & Dry Goods", "sriracha": "Pantry & Dry Goods",
  "dijon mustard": "Pantry & Dry Goods", mustard: "Pantry & Dry Goods",
  ketchup: "Pantry & Dry Goods", mayonnaise: "Pantry & Dry Goods",
  "coconut aminos": "Pantry & Dry Goods",
  tortillas: "Pantry & Dry Goods", "tortilla chips": "Pantry & Dry Goods",
  "pita bread": "Pantry & Dry Goods",
  // Canned & Jarred
  "chicken broth": "Canned & Jarred", "vegetable broth": "Canned & Jarred",
  "beef broth": "Canned & Jarred", broth: "Canned & Jarred", stock: "Canned & Jarred",
  "chicken stock": "Canned & Jarred", "beef stock": "Canned & Jarred",
  "diced tomatoes": "Canned & Jarred", "crushed tomatoes": "Canned & Jarred",
  "tomato paste": "Canned & Jarred", "tomato sauce": "Canned & Jarred",
  "coconut milk": "Canned & Jarred", "coconut cream": "Canned & Jarred",
  "black beans": "Canned & Jarred", chickpeas: "Canned & Jarred",
  "kidney beans": "Canned & Jarred", lentils: "Canned & Jarred",
  "white beans": "Canned & Jarred", "pinto beans": "Canned & Jarred",
  "roasted tomatoes": "Canned & Jarred", "sun-dried tomatoes": "Canned & Jarred",
  capers: "Canned & Jarred", olives: "Canned & Jarred",
  // Frozen
  "frozen peas": "Frozen", "frozen corn": "Frozen", "frozen edamame": "Frozen",
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
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return parseInt(frac[1]) / parseInt(frac[2]);
  return parseFloat(s);
}

function parseIngredientLine(line: string, recipeSlug: string, recipeName: string): ParsedIngredient {
  // Strip bullet, trailing asterisks/footnote markers, parenthetical notes
  const cleaned = line
    .replace(/^[-*•]\s*/, "")
    .replace(/\s*\([^)]*\)/g, "")  // strip "(about 1 cup)" style notes
    .replace(/\*+$/, "")            // strip trailing asterisks like "butter*"
    .replace(/,\s*$/, "")           // strip trailing comma
    .trim()
    .toLowerCase();

  if (!cleaned) {
    return { qty: null, unit: null, isFolkUnit: false, name: "", recipeSlug, recipeName };
  }

  // Pattern: "qty unit name" — single word for unit to prevent "tablespoons sour" bug
  const fullMatch = cleaned.match(/^((?:\d+\s+)?\d+(?:[./]\d+)?)\s+([a-zA-Z]+)\s+(.+)$/);
  if (fullMatch) {
    const qty = parseFraction(fullMatch[1]);
    const rawUnit = fullMatch[2];
    const nameStr = fullMatch[3].trim();
    const normalized = UNIT_ALIASES[rawUnit];
    if (normalized) {
      return { qty, unit: normalized, isFolkUnit: FOLK_UNITS.has(normalized), name: nameStr, recipeSlug, recipeName };
    }
    // First word isn't a known unit — treat it as part of the ingredient name
    return { qty, unit: null, isFolkUnit: false, name: `${rawUnit} ${nameStr}`, recipeSlug, recipeName };
  }

  // Pattern: "qty name" — e.g. "2 eggs", "3 limes"
  const simpleMatch = cleaned.match(/^((?:\d+\s+)?\d+(?:[./]\d+)?)\s+(.+)$/);
  if (simpleMatch) {
    return { qty: parseFraction(simpleMatch[1]), unit: null, isFolkUnit: false, name: simpleMatch[2].trim(), recipeSlug, recipeName };
  }

  // No quantity
  return { qty: null, unit: null, isFolkUnit: false, name: cleaned, recipeSlug, recipeName };
}

// ── Quantity display formatter ─────────────────────────────────────────────────

function formatQty(qty: number, unit: string | null): string {
  const rounded = Math.round(qty * 100) / 100;
  if (!unit) return String(rounded);
  const fractions: [number, string][] = [[0.25, "¼"], [0.33, "⅓"], [0.5, "½"], [0.67, "⅔"], [0.75, "¾"]];
  const whole = Math.floor(rounded);
  const decimal = rounded - whole;
  const frac = fractions.find(([v]) => Math.abs(decimal - v) < 0.04);
  const qtyStr = frac ? (whole > 0 ? `${whole} ${frac[1]}` : frac[1]) : String(rounded);
  return `${qtyStr} ${unit}`;
}

// ── Unit combination ──────────────────────────────────────────────────────────

interface CombinedQty {
  standard: number | null;
  standardUnit: "ml" | "g" | null;
  folk: string[];
  unitless: number | null;
}

// mealTargetServings maps recipeSlug → desired serving count for that meal
function combineIngredient(
  items: ParsedIngredient[],
  mealTargetServings: Record<string, number>,
  recipeServings: Record<string, number>
): { displayQty: string } {
  const combined: CombinedQty = { standard: null, standardUnit: null, folk: [], unitless: null };

  for (const item of items) {
    const recipeDefaultServings = recipeServings[item.recipeSlug] ?? 2;
    const targetServings = mealTargetServings[item.recipeSlug] ?? 2;
    const scaleFactor = recipeDefaultServings > 0 ? targetServings / recipeDefaultServings : 1;
    const scaledQty = item.qty !== null ? item.qty * scaleFactor : null;

    if (item.isFolkUnit && item.unit && scaledQty !== null) {
      combined.folk.push(formatQty(scaledQty, item.unit));
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
      combined.folk.push(formatQty(scaledQty, item.unit));
    }
  }

  const parts: string[] = [];

  if (combined.standard !== null && combined.standardUnit === "ml") {
    const ml = combined.standard;
    // Fixed thresholds: 240ml = 1 cup, 15ml = 1 tbsp
    if (ml >= 240) parts.push(formatQty(ml / 240, "cup"));
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
    const lower = name.toLowerCase();
    let found: FoodCategory | undefined;
    // Check more specific entries first (longer keys) to avoid "cheese" matching "cream cheese"
    const sortedKeys = Object.keys(INGREDIENT_CATEGORIES).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
      if (lower === key || lower.includes(key)) {
        found = INGREDIENT_CATEGORIES[key];
        break;
      }
    }
    if (found) result[name] = found;
    else unknown.push(name);
  }

  if (unknown.length === 0) return result;

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
  planServings: number,
  exclusions: string[] = []
): Promise<GroceryItem[]> {
  const recipeBySlug = new Map(recipes.map((r) => [r.slug, r]));

  // Per-recipe default servings (from recipe metadata)
  const recipeServings: Record<string, number> = {};
  for (const meal of meals) {
    const recipe = recipeBySlug.get(meal.recipeSlug);
    if (recipe?.servings) recipeServings[meal.recipeSlug] = recipe.servings;
  }

  // Per-meal target servings (uses individual override or plan default)
  const mealTargetServings: Record<string, number> = {};
  for (const meal of meals) {
    mealTargetServings[meal.recipeSlug] = meal.servings ?? planServings;
  }

  // Parse all ingredients from all meals
  const allIngredients: ParsedIngredient[] = [];
  for (const meal of meals) {
    const recipe = recipeBySlug.get(meal.recipeSlug);
    if (!recipe) continue;

    const ingredientsMatch = recipe.content.match(/##\s*Ingredients\s*\n([\s\S]*?)(?:\n##|\s*$)/i);
    if (!ingredientsMatch) continue;

    const lines = ingredientsMatch[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("-") || l.startsWith("*") || l.startsWith("•"));

    for (const line of lines) {
      const parsed = parseIngredientLine(line, meal.recipeSlug, meal.recipeName);
      if (parsed.name) allIngredients.push(parsed);
    }
  }

  // Group by normalized ingredient name
  const groups = new Map<string, ParsedIngredient[]>();
  for (const ingredient of allIngredients) {
    const key = ingredient.name.trim().toLowerCase().replace(/\s+/g, " ");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(ingredient);
  }

  // Apply pantry exclusions (exact name match)
  if (exclusions.length > 0) {
    const exclusionSet = new Set(exclusions.map((e) => e.toLowerCase().trim()));
    for (const key of Array.from(groups.keys())) {
      if (exclusionSet.has(key)) groups.delete(key);
    }
  }

  // Categorize remaining ingredients
  const names = Array.from(groups.keys());
  const categories = await categorizeIngredients(names);

  // Build final list
  const items: GroceryItem[] = [];
  for (const [name, group] of Array.from(groups)) {
    const sourceRecipes = Array.from(new Set(group.map((g) => g.recipeName)));
    const { displayQty } = combineIngredient(group, mealTargetServings, recipeServings);
    items.push({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      displayQty,
      category: categories[name] ?? "Other",
      sourceRecipes,
      hasMultipleSources: sourceRecipes.length > 1,
    });
  }

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
