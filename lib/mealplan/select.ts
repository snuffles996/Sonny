import type { Recipe } from "@/lib/recipes/types";
import type { UserProfile } from "@/lib/profile/types";
import type { MealPlan } from "./types";
import { pickMeals } from "@/lib/anthropic/mealplan";

export interface SelectionContext {
  allRecipes: Recipe[];
  activePlan: MealPlan | null;
  profile: UserProfile;
  busyNights: string[]; // ISO date strings of evenings with 2+ events or late events
  count: number;
  preferences?: string; // free-text from user, e.g. "nothing spicy"
}

export interface SuggestedMeal {
  recipe: Recipe;
  reason: string;
  quickMeal: boolean;
}

// Parse a totalTime string like "30m", "1h 15m", "45 min" → minutes, or null if unparseable
function parseTotalTimeMinutes(totalTime?: string): number | null {
  if (!totalTime) return null;
  const lower = totalTime.toLowerCase();
  let minutes = 0;
  const hours = lower.match(/(\d+)\s*h/);
  const mins = lower.match(/(\d+)\s*m/);
  if (hours) minutes += parseInt(hours[1], 10) * 60;
  if (mins) minutes += parseInt(mins[1], 10);
  return minutes > 0 ? minutes : null;
}

export async function selectMeals(ctx: SelectionContext): Promise<SuggestedMeal[]> {
  const { allRecipes, activePlan, profile, busyNights, count, preferences } = ctx;
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000);

  // Step 1: Exclude recently made (within 14 days)
  let candidates = allRecipes.filter((r) => {
    if (!r.lastMade) return true;
    return new Date(r.lastMade) < fourteenDaysAgo;
  });

  // Step 2: Exclude meals already in the active plan
  if (activePlan && activePlan.meals.length > 0) {
    const planSlugs = new Set(activePlan.meals.map((m) => m.recipeSlug));
    candidates = candidates.filter((r) => !planSlugs.has(r.slug));
  }

  // Step 3: Dietary filter (hard filter against profile.dietaryPreferences)
  if (profile.dietaryPreferences.length > 0) {
    const prefs = profile.dietaryPreferences.map((p) => p.toLowerCase());
    candidates = candidates.filter((r) => {
      const content = (r.name + " " + r.content + " " + (r.cuisine ?? "")).toLowerCase();
      // Exclude recipes that contain excluded ingredient markers
      for (const pref of prefs) {
        if (pref === "vegetarian" && /\b(meat|beef|chicken|pork|lamb|fish|seafood|bacon|turkey)\b/.test(content)) return false;
        if (pref === "vegan" && /\b(meat|beef|chicken|pork|lamb|fish|seafood|bacon|turkey|dairy|milk|cheese|butter|egg|eggs)\b/.test(content)) return false;
        if (pref === "gluten-free" && /\b(flour|pasta|bread|wheat|barley|rye)\b/.test(content)) return false;
        if (pref === "dairy-free" && /\b(milk|cheese|butter|cream|yogurt|dairy)\b/.test(content)) return false;
      }
      return true;
    });
  }

  // Tag quick meals (< 30 min)
  const tagged = candidates.map((r) => {
    const minutes = parseTotalTimeMinutes(r.totalTime);
    return { recipe: r, quickMeal: minutes !== null && minutes <= 30 };
  });

  // Step 4: Variety pass — cap any single cuisine at ceil(count/3)
  const maxPerCuisine = Math.ceil(count / 3);
  const cuisineCounts: Record<string, number> = {};
  const varied = tagged.filter(({ recipe }) => {
    const cuisine = (recipe.cuisine ?? "Other").toLowerCase();
    const current = cuisineCounts[cuisine] ?? 0;
    if (current >= maxPerCuisine) return false;
    cuisineCounts[cuisine] = current + 1;
    return true;
  });

  // If we culled too many candidates, fall back to full tagged list
  const pool = varied.length >= count ? varied : tagged;

  if (pool.length === 0) {
    return [];
  }

  // Step 5: Final selection by Sonnet
  const picked = await pickMeals(
    pool.map(({ recipe, quickMeal }) => ({
      slug: recipe.slug,
      name: recipe.name,
      cuisine: recipe.cuisine ?? "Other",
      totalTime: recipe.totalTime,
      quickMeal,
    })),
    Math.min(count, pool.length),
    preferences,
    busyNights.length
  );

  // Map picks back to full Recipe objects
  const recipeBySlug = new Map(pool.map(({ recipe, quickMeal }) => [recipe.slug, { recipe, quickMeal }]));
  const results: SuggestedMeal[] = [];
  for (const pick of picked) {
    const entry = recipeBySlug.get(pick.slug);
    if (entry) {
      results.push({ recipe: entry.recipe, reason: pick.reason, quickMeal: entry.quickMeal });
    }
  }
  return results;
}
