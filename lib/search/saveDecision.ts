// Haiku forced-tool-use call that decides whether a web search result is worth
// saving to long-term Pinecone memory.

import { getAnthropicClient, FAST_MODEL } from "@/lib/anthropic/client";

export interface SaveDecision {
  shouldSave: boolean;
  summary: string; // 2-3 sentence Q+A summary — only populated when shouldSave
  tags: string[];  // e.g. ["health", "running"]
}

export async function decideSave(query: string, responseText: string): Promise<SaveDecision> {
  const client = getAnthropicClient();

  const saveIf = [
    "Health, fitness, or wellness information",
    "A specific restaurant, place, or venue",
    "A product or service the user researched",
    "A how-to or reference the user may want again",
    "A recurring topic or interest",
  ].join("; ");

  const skipIf = [
    "Current news or ephemeral events",
    "Sports scores (handled separately)",
    "Simple one-off factual lookups",
    "Weather",
  ].join("; ");

  try {
    const response = await client.messages.create({
      model: FAST_MODEL,
      max_tokens: 256,
      system: `Decide whether to save a web search result to long-term memory.\nSave if: ${saveIf}.\nDo NOT save if: ${skipIf}.`,
      messages: [
        {
          role: "user",
          content: `Query: "${query}"\n\nResponse (first 500 chars): "${responseText.slice(0, 500)}"`,
        },
      ],
      tools: [
        {
          name: "save_decision",
          description: "Decide whether to save this search result",
          input_schema: {
            type: "object" as const,
            properties: {
              shouldSave: { type: "boolean" },
              summary: {
                type: "string",
                description: "2-3 sentence summary of the Q+A if saving, empty string if not",
              },
              tags: {
                type: "array",
                items: { type: "string" },
                description: "1-3 topic tags, e.g. health, running, restaurants",
              },
            },
            required: ["shouldSave", "summary", "tags"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "save_decision" },
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return { shouldSave: false, summary: "", tags: [] };
    return toolUse.input as SaveDecision;
  } catch {
    return { shouldSave: false, summary: "", tags: [] };
  }
}
