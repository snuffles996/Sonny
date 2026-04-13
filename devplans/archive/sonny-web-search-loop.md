# Sonny — Agentic Web Search Loop Implementation

**Feature:** Replace single-shot web search API call with a proper agentic tool-use
loop, matching how Claude.ai iteratively searches and synthesizes before responding.  
**Touches:** `lib/search/webSearch.ts` only — no other files need to change.

---

## The problem with the current implementation

The current `webSearch.ts` makes a single `anthropic.messages.create()` call with
the `web_search` tool attached. The model fires one search, gets results, and writes
a response. This is why it feels thin compared to Claude.ai.

Claude.ai runs search as a continuous reasoning loop:
- Search → evaluate results → decide if more is needed → search again with refined query
- Repeat until satisfied → write final response

The API supports this exact behavior. It just requires implementing the tool-use loop
correctly rather than treating it as a one-shot call.

---

## How the agentic tool loop works for `web_search`

Unlike custom tools (where YOU execute the function and return results), `web_search`
is a server-side Anthropic tool. The search executes on Anthropic's infrastructure.
You do not call any search API yourself.

The loop mechanics:

```
1. Send messages array to API with web_search tool attached
2. API returns response
3. Check stop_reason:
   - "tool_use"  → model wants to search; append assistant turn to messages; go to 1
   - "end_turn"  → model is done; extract final text; exit loop
4. There is no step where YOU handle tool_result — Anthropic injects search
   results automatically on the next API call when stop_reason was "tool_use"
```

The key insight: you just keep calling the API and appending the assistant's response
to the messages array. Anthropic handles the search execution between your calls.

---

## The rewritten `lib/search/webSearch.ts`

Replace the entire file with the following:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { SONNET_MODEL } from "@/lib/anthropic/client";
import { UserProfile } from "@/lib/profile/types";

const anthropic = new Anthropic();

export interface WebSearchResult {
  responseText: string;
  query: string;
  sourceUrls: string[];
  searchCount: number;   // how many searches the model ran — useful for debugging
}

// Safety limit — prevent runaway loops on unexpected API behavior
const MAX_ITERATIONS = 8;

export async function runWebSearch(
  userMessage: string,
  profile: UserProfile,
  sessionTurns: { role: string; content: string }[]
): Promise<WebSearchResult> {

  const systemPrompt = `You are Sonny, a personal AI assistant for ${profile.name ?? "Kevin"}.

Your job is to answer the user's question thoroughly using web search.

Search behavior:
- Before searching, internally reformulate the user's question into an optimal
  search query. Use specific terms, not conversational phrasing.
- If your first search results are insufficient, ambiguous, or incomplete —
  search again with a refined or different query. You may search multiple times.
- Only write your final response after you are satisfied with the search results.
- Synthesize across all searches into one clear, direct answer.
- Be concise. Lead with the answer, then supporting detail.
- If the topic is relevant to the user's profile, acknowledge that briefly.

User profile:
${JSON.stringify(profile, null, 2)}`;

  // Build initial messages array from session history + current message
  type MessageParam = Anthropic.Messages.MessageParam;
  let messages: MessageParam[] = [
    ...sessionTurns.map((t) => ({
      role: t.role as "user" | "assistant",
      content: t.content,
    })),
    { role: "user", content: userMessage },
  ];

  let responseText = "";
  let searchCount = 0;
  const sourceUrls: string[] = [];
  let iterations = 0;

  // --- The loop ---
  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
        },
      ],
      messages,
    });

    // Append the assistant's response to messages for the next iteration
    // This is required — the API needs the full conversation history including
    // all tool_use blocks to continue the loop correctly
    messages = [
      ...messages,
      {
        role: "assistant",
        content: response.content,
      },
    ];

    // Count searches and extract any source URLs from this turn
    for (const block of response.content) {
      if (block.type === "tool_use" && block.name === "web_search") {
        searchCount++;
      }

      // web_search_result blocks contain cited sources
      // Shape varies by SDK version — check block type and extract url fields
      if (block.type === "web_search_result_block" || block.type === "tool_result") {
        // Extract URLs if present — structure depends on SDK version
        // Uncomment and adapt once you verify the block shape in your environment:
        // if ("content" in block && Array.isArray(block.content)) {
        //   for (const item of block.content) {
        //     if (item.url) sourceUrls.push(item.url);
        //   }
        // }
      }
    }

    // Check if the model is done
    if (response.stop_reason === "end_turn") {
      // Extract all text blocks from the final response turn
      responseText = response.content
        .filter((block) => block.type === "text")
        .map((block) => (block as Anthropic.Messages.TextBlock).text)
        .join("\n")
        .trim();
      break;
    }

    // stop_reason === "tool_use" → loop continues
    // Anthropic injects search results automatically on the next API call
    // No action needed here — just loop
  }

  // Safety fallback — if we hit MAX_ITERATIONS without end_turn
  if (!responseText) {
    // Pull whatever text exists from the last assistant turn
    const lastAssistantTurn = messages.findLast((m) => m.role === "assistant");
    if (lastAssistantTurn && Array.isArray(lastAssistantTurn.content)) {
      responseText = lastAssistantTurn.content
        .filter((b: Anthropic.Messages.ContentBlock) => b.type === "text")
        .map((b: Anthropic.Messages.TextBlock) => b.text)
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
```

---

## What changed vs. the current implementation

| | Before | After |
|---|---|---|
| API calls per query | 1 | 1–4 typically, up to 8 |
| Search attempts | 1 | Model decides (usually 1–3) |
| Query refinement | None | Model reformulates automatically |
| Result synthesis | Single result set | Across multiple searches |
| Message history | Built once | Grows each iteration with assistant turns |
| Source URL extraction | Stubbed | Stubbed with clearer comment on where to adapt |
| Runaway protection | None | MAX_ITERATIONS = 8 |

---

## Token cost implication

Each iteration is a full API call. A query that triggers 3 searches will make 3
Sonnet calls, each with a growing messages array (because previous tool_use turns
are appended). Rough estimate for a 3-search query:

- Iteration 1: ~800 tokens
- Iteration 2: ~1200 tokens (includes previous turn)
- Iteration 3: ~1600 tokens (includes both previous turns)
- Total: ~3600 tokens vs ~800 tokens for the single-shot approach

This is acceptable for personal use at low volume. If you ever want to cap cost,
set MAX_ITERATIONS to 3 or 4 — the model usually finds a good answer in 2 searches
anyway.

---

## Source URL extraction — verify in your environment

The shape of web search result blocks varies slightly by SDK version. After deploying,
add a temporary debug log to inspect what the API actually returns:

```typescript
// Add temporarily after the messages.push() line inside the loop:
console.log("[webSearch] response blocks:", JSON.stringify(response.content, null, 2));
```

Run a test query, check Vercel logs, and look at the block types. Once you see the
actual shape, uncomment and adapt the URL extraction section in the loop. Remove the
debug log afterward.

---

## Verification checklist

- [ ] "What are the best running shoes for IT band issues?" → model searches 2–3 times, synthesizes a real answer
- [ ] "What's a good Italian restaurant near Petco Park?" → location-specific search, returns actual places
- [ ] Simple factual query → model searches once and ends (efficient)
- [ ] Check Vercel logs for `[webSearch] searchCount:` to confirm loop is running
- [ ] Confirm no runaway loops — MAX_ITERATIONS guard fires correctly if tested
- [ ] Save decision in `saveDecision.ts` still works — `responseText` is still a plain string, interface unchanged
- [ ] Session turns still passed correctly — existing conversation context flows into the loop

---

## No other files need to change

The `WebSearchResult` interface shape is unchanged — `responseText` is still a string,
so `saveDecision.ts`, `store.ts`, and `chat/route.ts` all work without modification.
Only `lib/search/webSearch.ts` is touched.
