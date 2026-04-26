// Fire-and-forget auto-save: after each exchange, Haiku decides if anything
// is worth persisting to long-term memory. Notes are date-prefixed so
// temporal queries ("what did I mention last week") work semantically.

import { getAnthropicClient, FAST_MODEL } from "@/lib/anthropic/client";
import { saveNote } from "@/lib/pinecone/records";
import type { UserId } from "@/lib/profile/types";

export async function autoSaveExchange(
  userId: UserId,
  userMessage: string,
  assistantReply: string,
  dateLabel: string // e.g. "April 12, 2026"
): Promise<void> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: FAST_MODEL,
    max_tokens: 256,
    system: `You decide whether a conversation exchange contains information worth saving to a personal AI assistant's long-term memory.

SAVE if the exchange reveals: preferences or opinions ("I prefer X", "I don't like Y"), plans or intentions, things the user wants to remember or come back to (shows, books, restaurants, ideas), notable events or decisions, facts about their life (job, family, hobbies, health).

DO NOT save: simple commands already handled by a dedicated system (grocery lists, calendar events, recipes, watch lists are stored elsewhere), pure acknowledgements ("thanks", "got it"), transient questions with no lasting relevance, or web search results (those have their own save flow).

Write summaries in third person, past tense. Start with the date.`,
    messages: [
      {
        role: "user",
        content: `User: ${userMessage}\n\nAssistant: ${assistantReply}`,
      },
    ],
    tools: [
      {
        name: "save_decision",
        description: "Decide whether to save this exchange to long-term memory",
        input_schema: {
          type: "object" as const,
          properties: {
            should_save: {
              type: "boolean",
              description: "Whether this exchange contains something worth saving to long-term memory",
            },
            confidence: {
              type: "string",
              enum: ["high", "low"],
              description: "high if clearly worth saving, low if borderline or uncertain",
            },
            summary: {
              type: "string",
              description: `Concise note text if should_save is true. Must start with "${dateLabel}: " and summarize only the notable information — not the full exchange. Omit if should_save is false.`,
            },
          },
          required: ["should_save", "confidence"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "save_decision" },
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return;

  const { should_save, confidence, summary } = toolUse.input as {
    should_save: boolean;
    confidence: "high" | "low";
    summary?: string;
  };

  if (should_save && confidence === "high" && summary?.trim()) {
    await saveNote(userId, summary.trim());
  }
}
