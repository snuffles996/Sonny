// Searches Redis lists relevant to a user query.
// Used in the query intent path to complement Pinecone note search.

import { getAnthropicClient, FAST_MODEL } from "@/lib/anthropic/client";
import { getUserListIndex } from "./index";
import { getList } from "./store";

export async function searchUserLists(userId: string, query: string): Promise<string | null> {
  const listNames = await getUserListIndex(userId);
  if (listNames.length === 0) return null;

  // Haiku picks which lists are semantically relevant to the query
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: FAST_MODEL,
    max_tokens: 128,
    system: "Given a user query and a set of named lists, return the list names that are relevant to answering the query. Be inclusive — if in doubt, include the list.",
    messages: [
      {
        role: "user",
        content: `Query: "${query}"\n\nAvailable lists: ${listNames.join(", ")}`,
      },
    ],
    tools: [
      {
        name: "match_lists",
        description: "Which lists are relevant to the user query",
        input_schema: {
          type: "object" as const,
          properties: {
            matched_lists: {
              type: "array",
              items: { type: "string" },
              description: "Names from the available lists that are relevant. Empty array if none match.",
            },
          },
          required: ["matched_lists"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "match_lists" },
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return null;
  const { matched_lists } = toolUse.input as { matched_lists: string[] };
  if (!matched_lists.length) return null;

  // Read each matched list and format
  const sections: string[] = [];
  for (const name of matched_lists) {
    const items = await getList(userId, name);
    if (!items.length) continue;
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    sections.push(`${label}: ${items.map((i) => i.text).join(", ")}`);
  }

  return sections.length > 0 ? sections.join("\n") : null;
}
