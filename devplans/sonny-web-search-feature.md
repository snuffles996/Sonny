# Sonny — Web Search Feature Implementation

**Feature:** Add `web_search` as a first-class intent, with selective Pinecone storage of personally relevant results.  
**Touches:** `lib/anthropic/classify.ts`, `lib/anthropic/respond.ts`, `lib/search/` (new), `app/api/chat/route.ts`

---

## Overview of the flow

```
User message
  → Haiku classifies intent as `web_search`
  → chat/route.ts calls webSearchHandler()
      → Sonnet call with web_search tool attached
      → Response streamed back to user
      → Haiku post-call: "is this worth saving?"
          → YES: embed Q+A summary → upsert to `{userId}-search` Pinecone namespace
          → NO: done
```

Existing `query` intent already searches `{userId}-notes` in Pinecone. After this feature ships, it will also search `{userId}-search` in parallel — so saved web lookups surface naturally in future queries.

---

## Step 1 — Add `web_search` to Haiku classifier

**File:** `lib/anthropic/classify.ts`

Add `web_search` to your intent enum and update the classification prompt. The key distinction to teach Haiku:

- Personal memory → `query`
- External world / current events / general knowledge → `web_search`

```typescript
// In your intent tool definition, add to the enum:
"web_search"

// In the classification system prompt, add guidance like:
`- web_search: The user is asking about something in the external world that 
   isn't stored in their personal notes. This includes current events, general 
   knowledge questions, restaurant or business lookups, health/fitness topics, 
   product research, how-to questions, or anything that would benefit from 
   up-to-date information from the web. Use this instead of 'query' when the 
   answer is clearly not something the user would have saved as a personal note.`
```

**Edge cases to handle in the prompt:**
- "What did I save about IT band?" → `query` (personal)
- "What's the best treatment for IT band syndrome?" → `web_search` (external)
- "When is the Padres next game?" → `sports_query` (already handled by ESPN)
- "What are good restaurants near Petco Park?" → `web_search`

---

## Step 2 — New file: `lib/search/webSearch.ts`

This is the main handler. It does three things: call Sonnet with the search tool, return the response text, and return structured metadata for the save decision.

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { SONNET_MODEL } from "@/lib/anthropic/client";
import { UserProfile } from "@/lib/profile/types";

const anthropic = new Anthropic(); // uses ANTHROPIC_API_KEY from env

export interface WebSearchResult {
  responseText: string;
  query: string;
  sourceUrls: string[];
}

export async function runWebSearch(
  userMessage: string,
  profile: UserProfile,
  sessionTurns: { role: string; content: string }[]
): Promise<WebSearchResult> {

  const systemPrompt = `You are Sonny, a personal AI assistant for ${profile.name ?? "Kevin"}.
Answer the user's question using web search. Be concise and direct.
If the topic is personally relevant to the user based on their profile, note that briefly.

User profile context:
${JSON.stringify(profile, null, 2)}`;

  const messages = [
    ...sessionTurns,
    { role: "user" as const, content: userMessage },
  ];

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

  // Collect all text blocks across tool use + final response
  const responseText = response.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { type: "text"; text: string }).text)
    .join("\n");

  // Extract any URLs from web_search tool result blocks
  const sourceUrls: string[] = [];
  for (const block of response.content) {
    if (block.type === "tool_result") {
      // tool_result content can contain cited URLs — parse if needed
      // For now, leave this as a stub; Anthropic may expose these differently
      // depending on SDK version. Check block.content for url fields.
    }
  }

  return { responseText, query: userMessage, sourceUrls };
}
```

**Note on source URLs:** The web search tool's cited sources are returned inside `tool_result` blocks in the message history. Check the current SDK typings for the exact shape — this may require iterating `response.content` for `tool_use` blocks and then matching their results. The implementation above stubs this correctly; flesh it out once you verify the block structure in your environment.

---

## Step 3 — New file: `lib/search/saveDecision.ts`

A fast Haiku call that decides whether to persist the result.

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { HAIKU_MODEL } from "@/lib/anthropic/client";

const anthropic = new Anthropic();

export interface SaveDecision {
  shouldSave: boolean;
  summary: string;    // condensed Q+A for embedding — only populated if shouldSave
  tags: string[];     // e.g. ["health", "running"] — for future filtering
}

export async function decideSave(
  query: string,
  responseText: string
): Promise<SaveDecision> {

  const prompt = `You are deciding whether a web search result is personally useful enough to save 
to a user's long-term memory database.

SAVE if the result is:
- Health, fitness, or wellness related
- A specific restaurant, place, or venue
- A product or service the user researched
- A how-to or reference the user may want again
- Anything that seems like a recurring interest

DO NOT SAVE if the result is:
- Current news or ephemeral events
- Sports scores (handled separately)
- Simple one-off factual lookups (e.g. "what year was X founded")
- Weather

Query: "${query}"

Response summary (first 500 chars): "${responseText.slice(0, 500)}"

Respond with ONLY valid JSON, no markdown:
{
  "shouldSave": true | false,
  "summary": "2-3 sentence summary of the Q+A if saving, empty string if not",
  "tags": ["tag1", "tag2"]
}`;

  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return { shouldSave: false, summary: "", tags: [] };
  }
}
```

---

## Step 4 — New file: `lib/search/store.ts`

Saves the search result to Pinecone using your existing records pattern.

```typescript
import { getPineconeClient } from "@/lib/pinecone/client";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export async function saveSearchResult({
  userId,
  query,
  summary,
  tags,
  sourceUrls,
}: {
  userId: string;
  query: string;
  summary: string;
  tags: string[];
  sourceUrls: string[];
}): Promise<void> {
  const namespace = `${userId}-search`;
  const pinecone = getPineconeClient();
  const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);

  // Embed the summary text
  const embeddingResponse = await anthropic.embeddings.create({
    model: "voyage-3",   // or whatever embedding model you're currently using
    input: `${query}\n\n${summary}`,
  });

  // NOTE: If you're using Pinecone's inference for embeddings rather than 
  // Anthropic's, swap this out for your existing embed() helper from records.ts

  const vector = embeddingResponse.embeddings[0].embedding;
  const id = `search-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  await index.namespace(namespace).upsert([
    {
      id,
      values: vector,
      metadata: {
        type: "web_search",
        query,
        summary,
        tags,
        sourceUrls,
        date: new Date().toISOString(),
      },
    },
  ]);
}
```

**Important:** Match the embedding model and dimension to whatever you're already using in `lib/pinecone/records.ts` — don't introduce a second embedding model. Check your existing `saveNote` implementation and copy that embed call pattern exactly.

---

## Step 5 — Wire it into `app/api/chat/route.ts`

In your main chat handler, add the `web_search` branch alongside the existing intent branches:

```typescript
import { runWebSearch } from "@/lib/search/webSearch";
import { decideSave } from "@/lib/search/saveDecision";
import { saveSearchResult } from "@/lib/search/store";
import { searchNotes } from "@/lib/pinecone/records"; // reuse for cross-namespace search

// --- inside your intent switch/if-else ---

if (intent === "web_search") {
  // 1. Run the search + get response
  const result = await runWebSearch(userMessage, profile, sessionTurns);

  // 2. Return response to user immediately
  // (use your existing response pattern — streaming or not)
  respondToUser(result.responseText);

  // 3. Async post-processing — don't await, don't block the response
  (async () => {
    try {
      const decision = await decideSave(result.query, result.responseText);
      if (decision.shouldSave) {
        await saveSearchResult({
          userId,
          query: result.query,
          summary: decision.summary,
          tags: decision.tags,
          sourceUrls: result.sourceUrls,
        });
      }
    } catch (err) {
      console.error("[web_search] save decision failed:", err);
      // non-fatal — never surface this to the user
    }
  })();

  return; // done
}
```

**Vercel + async note:** Vercel serverless functions terminate after the response is sent. The async save block above may get cut off. Two options:
- Use `waitUntil()` from the Vercel edge runtime if you're on the edge runtime
- Or just accept occasional missed saves — the save is best-effort and non-critical
- Better: move the save into a separate `POST /api/search-save` internal endpoint and fire-and-forget with `fetch()`

---

## Step 6 — Update `query` intent to also search `{userId}-search`

In your existing `query` handler (wherever you call `searchNotes`), add a parallel search of the `-search` namespace so that saved web lookups surface alongside personal notes:

```typescript
// Existing:
const personalNotes = await searchNotes(userMessage, `${userId}-notes`);

// Add:
const searchHistory = await searchNotes(userMessage, `${userId}-search`);

// Merge and pass both as context to Sonnet:
const context = [...personalNotes, ...searchHistory];
```

This is the key payoff — Kevin asks "remind me what I found about IT band stuff" and Sonny retrieves the saved web result without Kevin having to explicitly save it.

---

## New Pinecone namespaces

| Namespace | Owner | Purpose |
|---|---|---|
| `kevin-search` | Kevin | Saved web search results |
| `kylie-search` | Kylie | Saved web search results |

These follow the same per-user namespace pattern already established. No index changes needed — same index, new namespace strings.

---

## File summary — what to create / edit

| File | Action | Notes |
|---|---|---|
| `lib/anthropic/classify.ts` | Edit | Add `web_search` to intent enum + prompt |
| `lib/search/webSearch.ts` | Create | Sonnet call with web_search tool |
| `lib/search/saveDecision.ts` | Create | Haiku call — should this be saved? |
| `lib/search/store.ts` | Create | Pinecone upsert to `{userId}-search` namespace |
| `app/api/chat/route.ts` | Edit | Add `web_search` branch to intent router |
| `lib/pinecone/records.ts` | Edit | Update `searchNotes` call in `query` handler to merge `-search` namespace |

---

## Token cost estimate

Per `web_search` query:
- Haiku classification: ~200 tokens (same as today — no change)
- Sonnet + web_search tool: ~800–1500 tokens depending on search results returned
- Haiku save decision: ~300 tokens
- Total marginal cost vs. current `query` intent: roughly +1000–1500 tokens per web search

This is acceptable for personal use. The save decision call only fires after the user already has their answer, so it doesn't affect perceived latency.

---

## What to verify before shipping

- [ ] Confirm the web_search tool type string (`web_search_20250305`) is current — check Anthropic docs for the latest tool version identifier
- [ ] Match the embedding model in `store.ts` to whatever `lib/pinecone/records.ts` uses today
- [ ] Test the Haiku classifier on ~10 sample messages to confirm `web_search` vs `query` routing is correct
- [ ] Decide on the Vercel async save strategy (fire-and-forget vs `waitUntil` vs internal endpoint)
- [ ] Confirm `{userId}-search` namespace doesn't need to be pre-created in Pinecone (usually namespaces are created on first upsert — verify this with your index)
