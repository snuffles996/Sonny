import { getAnthropicClient, FAST_MODEL } from "@/lib/anthropic/client";
import { getOverrides } from "@/lib/lists/overrides";
import { getPantryStaples } from "@/lib/pantry/store";

const CATEGORY_MAP = `
Grocery store categories and what belongs in each. Use ONLY these category names:

- Produce: Fresh fruits, fresh vegetables, fresh herbs, mushrooms, bagged salad
- Bakery: Bread, buns, rolls, bagels, tortillas, pita, muffins, croissants — ANY baked good
- Meat & Seafood: Raw meat, poultry, fish, seafood, deli meat, bacon, sausage
- Dairy & Eggs: Milk, cheese, butter, yogurt, cream, eggs, non-dairy milk alternatives
- Frozen: Anything frozen — vegetables, meals, ice cream, frozen fruit
- Pantry: Canned goods, pasta, rice, grains, oils, vinegar, sauces, condiments, spices, baking ingredients, nuts, dried beans
- Beverages: Water, juice, soda, coffee, tea, alcohol, sports drinks
- Snacks: Chips, crackers, cookies, candy, granola bars, popcorn
- Personal Care: Soap, shampoo, toothpaste, deodorant, razors, vitamins
- Household: Paper towels, toilet paper, cleaning supplies, trash bags, laundry detergent, batteries
- Baby & Pet: Pet food, pet supplies, baby food, diapers

Key rules:
- "Potato buns" → Bakery (not Produce — potato is the flavor, not the form)
- "Sweet potato" → Produce (it IS a vegetable)
- "Almond milk" → Dairy & Eggs
- "Frozen vegetables" → Frozen (not Produce)
- "Canned tomatoes" → Pantry (not Produce)
- "Turkey" (raw) → Meat & Seafood; "Turkey" (deli) → Meat & Seafood
- When in doubt between Pantry and another category, prefer the more specific category
`.trim();

export async function categorizeItems(
  items: string[]
): Promise<Map<string, string>> {
  if (!items.length) return new Map();

  const [overrides, staples] = await Promise.all([
    getOverrides(),
    getPantryStaples(),
  ]);

  const result = new Map<string, string>();
  const needsCategorization: string[] = [];

  for (const item of items) {
    const override = overrides.get(item.toLowerCase().trim());
    if (override) {
      result.set(item.toLowerCase().trim(), override);
    } else {
      needsCategorization.push(item);
    }
  }

  if (!needsCategorization.length) return result;

  const staplesContext =
    staples.length > 0
      ? `\n\nNote: The household pantry staples include: ${staples.join(", ")}. Categorize them normally if asked.`
      : "";

  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: FAST_MODEL,
    max_tokens: 512,
    system: `${CATEGORY_MAP}${staplesContext}`,
    messages: [
      {
        role: "user",
        content: `Categorize each of these items:\n${needsCategorization.map((i) => `- ${i}`).join("\n")}`,
      },
    ],
    tools: [
      {
        name: "categorize_items",
        description: "Return the grocery category for each item",
        input_schema: {
          type: "object" as const,
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  category: { type: "string" },
                },
                required: ["name", "category"],
              },
            },
          },
          required: ["items"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "categorize_items" },
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (toolUse && toolUse.type === "tool_use") {
    const input = toolUse.input as { items: { name: string; category: string }[] };
    for (const { name, category } of input.items) {
      result.set(name.toLowerCase().trim(), category);
    }
  } else {
    for (const item of needsCategorization) {
      result.set(item.toLowerCase().trim(), "Other");
    }
  }

  return result;
}
