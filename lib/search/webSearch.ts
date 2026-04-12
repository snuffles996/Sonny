// Runs a web search using Anthropic's built-in web_search tool.
// Returns the synthesized response text and any cited source URLs.

import { getAnthropicClient, MODEL } from "@/lib/anthropic/client";
import type { UserProfile } from "@/lib/profile/types";
import type { Turn } from "@/lib/session/kv";

export interface WebSearchResult {
  responseText: string;
  query: string;
  sourceUrls: string[];
}

export async function runWebSearch(
  userMessage: string,
  profile: UserProfile,
  sessionTurns: Turn[]
): Promise<WebSearchResult> {
  const client = getAnthropicClient();

  const systemPrompt = [
    `You are Sonny, a personal AI assistant for ${profile.userId}.`,
    `Answer the user's question using web search. Be concise and direct.`,
    profile.homeLocation ? `User is based in ${profile.homeLocation}.` : "",
    profile.hobbiesAndInterests.length > 0
      ? `Interests: ${profile.hobbiesAndInterests.join(", ")}.`
      : "",
  ].filter(Boolean).join("\n");

  const messages: { role: "user" | "assistant"; content: string }[] = [
    ...sessionTurns.map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: userMessage },
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: [{ type: "web_search_20260209", name: "web_search" }] as any,
    messages,
  });

  // Collect all text blocks (the synthesized answer)
  const responseText = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n")
    .trim();

  // Extract cited URLs from web_search_tool_result blocks
  const sourceUrls: string[] = [];
  for (const block of response.content) {
    if (block.type === "web_search_tool_result") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content = (block as any).content;
      if (Array.isArray(content)) {
        for (const item of content) {
          if (item?.type === "web_search_result" && item?.url) {
            sourceUrls.push(item.url);
          }
        }
      }
    }
  }

  return { responseText, query: userMessage, sourceUrls };
}
