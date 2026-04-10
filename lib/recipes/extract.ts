import { getAnthropicClient, FAST_MODEL } from "@/lib/anthropic/client";
import type { Recipe } from "./types";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseDuration(iso: string): string | undefined {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return undefined;
  const h = parseInt(m[1] || "0");
  const min = parseInt(m[2] || "0");
  if (h && min) return `${h}h ${min}m`;
  if (h) return `${h}h`;
  if (min) return `${min}m`;
  return undefined;
}

function tryJsonLd(html: string): Partial<Recipe> | null {
  const re = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const raw = JSON.parse(m[1]);
      const nodes = Array.isArray(raw)
        ? raw
        : raw["@graph"]
        ? raw["@graph"]
        : [raw];
      const r = nodes.find((n: Record<string, unknown>) => {
        const t = n["@type"];
        return t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"));
      });
      if (!r) continue;

      // Ingredients
      const ingredientLines: string[] = (r.recipeIngredient as string[]) ?? [];
      const ingredientsMd = ingredientLines.map((l) => `- ${l}`).join("\n");

      // Instructions
      let instructionsMd = "";
      const instr = r.recipeInstructions;
      if (Array.isArray(instr)) {
        instructionsMd = instr
          .map((step: Record<string, unknown> | string, i: number) => {
            const text =
              typeof step === "string"
                ? step
                : (step.text as string) ?? "";
            return `${i + 1}. ${text}`;
          })
          .join("\n");
      } else if (typeof instr === "string") {
        instructionsMd = instr;
      }

      const content = [
        ingredientsMd ? `## Ingredients\n${ingredientsMd}` : "",
        instructionsMd ? `## Instructions\n${instructionsMd}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const cuisineRaw = r.recipeCuisine as string | string[] | undefined;
      const cuisine = Array.isArray(cuisineRaw)
        ? cuisineRaw[0]
        : cuisineRaw ?? "";

      const yieldRaw = r.recipeYield;
      const servings =
        typeof yieldRaw === "number"
          ? yieldRaw
          : typeof yieldRaw === "string"
          ? parseInt(yieldRaw) || undefined
          : Array.isArray(yieldRaw)
          ? parseInt(yieldRaw[0]) || undefined
          : undefined;

      return {
        name: (r.name as string) || "",
        cuisine,
        servings,
        totalTime: parseDuration((r.totalTime as string) ?? ""),
        content,
      };
    } catch {
      continue;
    }
  }
  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);
}

async function extractWithClaude(
  pageText: string
): Promise<Partial<Recipe> | null> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: FAST_MODEL,
    max_tokens: 1024,
    system:
      "You are a recipe extraction assistant. Extract structured recipe data from the provided page text.",
    messages: [{ role: "user", content: pageText }],
    tools: [
      {
        name: "save_recipe",
        description: "Save the extracted recipe",
        input_schema: {
          type: "object" as const,
          properties: {
            name: { type: "string" },
            cuisine: {
              type: "string",
              description:
                "One of: American, Italian, Asian, Mexican, Mediterranean, European, Dessert, or similar",
            },
            servings: { type: "number" },
            totalTime: {
              type: "string",
              description: "e.g. 30m, 1h, 1h 30m",
            },
            ingredientsMarkdown: {
              type: "string",
              description: "Bullet list of ingredients",
            },
            instructionsMarkdown: {
              type: "string",
              description: "Numbered list of steps",
            },
          },
          required: ["name", "ingredientsMarkdown", "instructionsMarkdown"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "save_recipe" },
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return null;
  const inp = toolUse.input as Record<string, string | number>;

  return {
    name: inp.name as string,
    cuisine: (inp.cuisine as string) || "",
    servings: inp.servings as number | undefined,
    totalTime: (inp.totalTime as string) || undefined,
    content: `## Ingredients\n${inp.ingredientsMarkdown}\n\n## Instructions\n${inp.instructionsMarkdown}`,
  };
}

export async function extractRecipeFromUrl(url: string): Promise<Recipe | null> {
  let html: string;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  // Try structured JSON-LD first (most recipe sites implement schema.org/Recipe)
  let partial = tryJsonLd(html);

  // Fall back to Claude if JSON-LD extraction yielded no content
  if (!partial || !partial.content) {
    partial = await extractWithClaude(stripHtml(html));
  }

  if (!partial?.name) return null;

  const hostname = new URL(url).hostname.replace(/^www\./, "");

  const name = partial.name;
  return {
    slug: slugify(name),
    name,
    cuisine: partial.cuisine || "",
    source: hostname,
    url,
    servings: partial.servings,
    totalTime: partial.totalTime,
    addedDate: new Date().toISOString().split("T")[0],
    content: partial.content || "",
  };
}

export function extractUrlFromMessage(message: string): string | null {
  const m = message.match(/https?:\/\/[^\s)>'"]+/);
  return m ? m[0] : null;
}
