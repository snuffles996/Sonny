// Runs an agentic web search loop using Anthropic's built-in web_search tool.
// The model searches → evaluates → refines and searches again until satisfied,
// then writes a final synthesized response.

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

// Safety limit — prevents runaway loops on unexpected API behavior
const MAX_ITERATIONS = 8;

export async function runWebSearch(
  userMessage: string,
  profile: UserProfile,
  sessionTurns: Turn[]
): Promise<WebSearchResult> {
  const client = getAnthropicClient();

  const systemPrompt = [
    `You are Sonny, a personal AI assistant for ${profile.userId}.`,
    `Your job is to answer the user's question thoroughly using web search.`,
    `Search behavior:`,
    `- Before searching, internally reformulate the user's question into an optimal search query. Use specific terms, not conversational phrasing.`,
    `- If your first search results are insufficient, ambiguous, or incomplete — search again with a refined or different query. You may search multiple times.`,
    `- Only write your final response after you are satisfied with the search results.`,
    `- Synthesize across all searches into one clear, direct answer.`,
    `- Be concise. Lead with the answer, then supporting detail.`,
    profile.homeLocation ? `User is based in ${profile.homeLocation}.` : "",
    profile.hobbiesAndInterests.length > 0
      ? `Interests: ${profile.hobbiesAndInterests.join(", ")}.`
      : "",
  ].filter(Boolean).join("\n");

  type MessageParam = Anthropic.Messages.MessageParam;
  let messages: MessageParam[] = [
    ...sessionTurns.map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: userMessage },
  ];

  let responseText = "";
  let searchCount = 0;
  const sourceUrls: string[] = [];
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: "web_search_20260209", name: "web_search" }] as any,
      messages,
    });

    // Append assistant turn so the next iteration has the full conversation
    messages = [
      ...messages,
      { role: "assistant", content: response.content },
    ];

    // Count searches and collect source URLs from this turn
    for (const block of response.content) {
      if (block.type === "tool_use" && block.name === "web_search") {
        searchCount++;
      }
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

    if (response.stop_reason === "end_turn") {
      responseText = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as Anthropic.Messages.TextBlock).text)
        .join("\n")
        .trim();
      break;
    }

    // stop_reason === "tool_use" → Anthropic injects search results automatically
    // on the next API call. Just loop.
  }

  // Safety fallback — pull whatever text exists from the last assistant turn
  if (!responseText) {
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (lastAssistant && Array.isArray(lastAssistant.content)) {
      responseText = (lastAssistant.content as Anthropic.Messages.ContentBlock[])
        .filter((b) => b.type === "text")
        .map((b) => (b as Anthropic.Messages.TextBlock).text)
        .join("\n")
        .trim();
    }
    console.warn(`[webSearch] hit MAX_ITERATIONS (${MAX_ITERATIONS}) without end_turn`);
  }

  return {
    responseText: responseText || "I wasn't able to find a clear answer. Try rephrasing?",
    query: userMessage,
    sourceUrls,
    searchCount,
  };
}
