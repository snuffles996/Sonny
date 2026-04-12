// Runs a web search using Anthropic's built-in web_search tool.
// web_search is a server-side tool — Anthropic executes searches internally
// during generation. The model can search multiple times within a single API
// call; always returns end_turn with all results included in the response.

import { getAnthropicClient, MODEL } from "@/lib/anthropic/client";
import type { UserProfile } from "@/lib/profile/types";
import type { Turn } from "@/lib/session/kv";
import type Anthropic from "@anthropic-ai/sdk";

export interface WebSearchResult {
  responseText: string;
  query: string;
  sourceUrls: string[];
  searchCount: number;
}

export async function runWebSearch(
  userMessage: string,
  profile: UserProfile,
  sessionTurns: Turn[]
): Promise<WebSearchResult> {
  const client = getAnthropicClient();

  const systemPrompt = [
    `You are Sonny, a personal AI assistant for ${profile.userId}.`,
    `Your job is to answer the user's question thoroughly using web search.`,
    `- Before searching, reformulate the question into an optimal search query using specific terms, not conversational phrasing.`,
    `- If the first results are insufficient or incomplete, search again with a refined query.`,
    `- Synthesize across all searches into one clear, direct answer.`,
    `- Be concise. Lead with the answer, then supporting detail.`,
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

  const responseText = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.Messages.TextBlock).text)
    .join("\n")
    .trim();

  // Count how many search calls the model made
  const searchCount = response.content.filter(
    (b) => b.type === "tool_use" && b.name === "web_search"
  ).length;

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

  return {
    responseText: responseText || "I wasn't able to find a clear answer. Try rephrasing?",
    query: userMessage,
    sourceUrls,
    searchCount,
  };
}
