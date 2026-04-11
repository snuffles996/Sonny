// Anthropic helpers for meal planning — Haiku for fast extraction,
// Sonnet for final recipe selection (requires reasoning about variety, preferences, etc.).

import { getAnthropicClient, MODEL, FAST_MODEL } from "./client";
import type { PlannedMeal } from "@/lib/mealplan/types";

interface MealCandidate {
  slug: string;
  name: string;
  cuisine: string;
  totalTime?: string;
  quickMeal: boolean;
}

interface PickedMeal {
  slug: string;
  reason: string;
}

// Use Sonnet to select the final N recipes from a filtered candidate list.
export async function pickMeals(
  candidates: MealCandidate[],
  count: number,
  preferences?: string,
  busyNightCount?: number
): Promise<PickedMeal[]> {
  const client = getAnthropicClient();

  const candidateList = candidates
    .map((c) => `- ${c.slug}: ${c.name} (${c.cuisine}${c.totalTime ? `, ${c.totalTime}` : ""}${c.quickMeal ? ", quick" : ""})`)
    .join("\n");

  const prefNote = preferences ? `\nUser preferences/notes: "${preferences}"` : "";
  const busyNote = busyNightCount && busyNightCount > 0
    ? `\nThe user has ${busyNightCount} busy evening(s) this week — prefer quick meals for those nights.`
    : "";

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: `You are helping plan meals for the week. Select exactly ${count} recipes from the candidates list. Maximize variety: spread across different cuisines AND different proteins (beef, chicken, pork, seafood, vegetarian). Avoid picking more than one recipe that shares the same main protein unless no other options exist. Give a brief, friendly reason for each pick (1 sentence).${prefNote}${busyNote}`,
      messages: [{ role: "user", content: `Candidates:\n${candidateList}\n\nSelect ${count} meals.` }],
      tools: [
        {
          name: "select_meals",
          description: `Select exactly ${count} meals from the candidates`,
          input_schema: {
            type: "object" as const,
            properties: {
              selections: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    slug: { type: "string" },
                    reason: { type: "string" },
                  },
                  required: ["slug", "reason"],
                },
                minItems: count,
                maxItems: count,
              },
            },
            required: ["selections"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "select_meals" },
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return [];
    const input = toolUse.input as { selections: PickedMeal[] };
    return input.selections ?? [];
  } catch {
    // Fallback: just pick the first N candidates in order
    return candidates.slice(0, count).map((c) => ({ slug: c.slug, reason: "Selected for variety." }));
  }
}

// Use Haiku to identify which meal in the plan the user wants to swap.
// Returns the recipeSlug of the meal to replace, or null if unclear.
export async function identifySwapTarget(
  message: string,
  currentMeals: PlannedMeal[]
): Promise<string | null> {
  const client = getAnthropicClient();

  const mealList = currentMeals
    .map((m, i) => `${i + 1}. ${m.recipeName} (slug: ${m.recipeSlug})`)
    .join("\n");

  try {
    const response = await client.messages.create({
      model: FAST_MODEL,
      max_tokens: 64,
      system: "Identify which meal the user wants to swap from the current meal plan.",
      messages: [{ role: "user", content: `Current meal plan:\n${mealList}\n\nUser message: "${message}"` }],
      tools: [
        {
          name: "identify_swap",
          description: "Identify the recipe slug of the meal to swap",
          input_schema: {
            type: "object" as const,
            properties: {
              slug: {
                type: "string",
                description: "The recipeSlug of the meal to swap, or empty string if unclear",
              },
            },
            required: ["slug"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "identify_swap" },
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return null;
    const input = toolUse.input as { slug: string };
    return input.slug || null;
  } catch {
    return null;
  }
}
