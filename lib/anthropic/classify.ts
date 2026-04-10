import { getAnthropicClient, FAST_MODEL } from "./client";

export type Intent =
  | "save_note"
  | "query"
  | "calendar_read"
  | "calendar_write"
  | "profile_update";

const INTENT_DESCRIPTIONS = [
  "save_note: user wants to save, remember, or log something",
  "query: user is asking a question or requesting information",
  "calendar_read: user wants to see upcoming events or check their schedule",
  "calendar_write: user wants to add, change, or remove a calendar event",
  "profile_update: user wants to update their personal preferences or profile info",
].join("\n");

export async function classifyIntent(message: string): Promise<Intent> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: FAST_MODEL,
    max_tokens: 64,
    system: `Classify the user's message into exactly one intent.\n\nIntents:\n${INTENT_DESCRIPTIONS}`,
    messages: [{ role: "user", content: message }],
    tools: [
      {
        name: "classify_intent",
        description: "Return the intent of the user message",
        input_schema: {
          type: "object" as const,
          properties: {
            intent: {
              type: "string",
              enum: [
                "save_note",
                "query",
                "calendar_read",
                "calendar_write",
                "profile_update",
              ],
            },
          },
          required: ["intent"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "classify_intent" },
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return "query";
  return (toolUse.input as { intent: Intent }).intent;
}
