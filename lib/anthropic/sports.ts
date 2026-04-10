// Fast extraction helper for sports queries where detectTeam() isn't sufficient.
// Uses Haiku forced tool_use — same pattern as calendar.ts and profile.ts.

import { getAnthropicClient, FAST_MODEL } from "./client";

interface SportsQueryExtraction {
  playerName?: string;
  sport?: "baseball/mlb" | "football/nfl" | "basketball/nba" | "hockey/nhl";
}

export async function extractSportsQuery(message: string): Promise<SportsQueryExtraction> {
  const client = getAnthropicClient();
  try {
    const response = await client.messages.create({
      model: FAST_MODEL,
      max_tokens: 128,
      system: "Extract sports query details from the user's message.",
      messages: [{ role: "user", content: message }],
      tools: [
        {
          name: "extract_sports_query",
          description: "Extract the player name and/or sport from a sports stats query",
          input_schema: {
            type: "object" as const,
            properties: {
              playerName: {
                type: "string",
                description: "The athlete's name as mentioned by the user",
              },
              sport: {
                type: "string",
                enum: ["baseball/mlb", "football/nfl", "basketball/nba", "hockey/nhl"],
                description: "The sport, if determinable from context",
              },
            },
            required: [],
          },
        },
      ],
      tool_choice: { type: "tool", name: "extract_sports_query" },
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return {};
    return toolUse.input as SportsQueryExtraction;
  } catch {
    return {};
  }
}
