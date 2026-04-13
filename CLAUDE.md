# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # start local dev server (localhost:3000)
npm run build    # production build — run this to catch TypeScript errors
npm run lint     # ESLint via next lint
```

No test suite exists yet. Use `npm run build` as the primary correctness check — the project uses TypeScript strict mode.

## ARCHITECTURE.md maintenance

**Update `ARCHITECTURE.md` before every commit if any of the following changed:**
- Redis key patterns or Pinecone namespaces
- Intent list or ClassificationResult fields
- New files in `lib/` or new API routes
- Session/memory behavior
- Resolved or newly identified open items

If something was decided against or deferred, add it to the **Open Items** section in `ARCHITECTURE.md` with a brief note on why it was held.

## Architecture

**Stack:** Next.js 14 App Router · TypeScript · Vercel · Anthropic SDK (direct, not AI SDK) · Pinecone · Upstash Redis · iCloud CalDAV

### Request flow

All user interactions enter through `POST /api/chat`. The handler:
1. Authenticates via Bearer token → resolves to `"kevin"` or `"kylie"`
2. Runs profile load, session turns, intent classification, Pinecone note search, and Redis list search **in parallel**
3. Routes to a handler based on the classified intent
4. Persists both turns to Redis **sequentially** (order matters)
5. Fire-and-forget: `autoSaveExchange()` runs after response for non-dedicated-write intents
6. Returns `{ reply, intent, saved }`

### Dual-model pattern

- **Sonnet** (`MODEL` in `lib/anthropic/client.ts`) — response generation in `lib/anthropic/respond.ts`
- **Haiku** (`FAST_MODEL`) — all extraction and classification tasks: `classify.ts`, `calendar.ts`, `profile.ts`, `recipes/extract.ts`

All Haiku calls use **forced tool_use** (`tool_choice: { type: "tool" }` with a required input schema). Follow this same pattern when adding new extraction functions.

### Intent system

`lib/anthropic/classify.ts` defines the `Intent` union type and calls Haiku to classify. Returns `ClassificationResult` which carries `intent` plus optional structured fields (`listName`, `items`, `staplesAction`, etc.). When adding a new capability:
1. Add the new intent string to the `Intent` type in `classify.ts`
2. Add a description to the system prompt array and the enum in the tool schema
3. Add a `case` handler in the chat route switch statement
4. Update the capabilities list in `lib/anthropic/respond.ts` `buildSystemPrompt()`

### CalDAV (iCloud)

**Do not use the `tsdav` package** — it's installed but not used. iCloud's CalDAV redirects strip the `Authorization` header, so all requests go through `calFetch()` in `lib/caldav/client.ts`, which manually follows redirects and re-attaches auth. **Any new CalDAV or Reminders code must use `calFetch()`**, not raw `fetch()`.

- Reads: `lib/caldav/events.ts` — `getUpcomingEvents()`, `fetchCalendarIcals()`
- Writes: `lib/caldav/events.ts` — `createEvent()` via `putCalendarObject()` in client
- Calendar selection is env-driven: `CALDAV_READ_CALENDARS`, `CALDAV_WRITE_CALENDAR`
- iCloud Reminders: **not integrated**. Apple's modern personal Reminders lists use CloudKit and are not accessible via CalDAV. The `caldav.icloud.com` endpoint only exposes legacy shared/collaborative lists.

### Data storage patterns

| Data | Key pattern | File |
|---|---|---|
| User profile | `profile:{userId}` | `lib/profile/store.ts` |
| Session turns | `session:{userId}` | `lib/session/kv.ts` |
| Recipes | `data:recipes` (full array) | `lib/recipes/store.ts` |
| Active meal plan | `mealplan:shared:active` | `lib/mealplan/store.ts` |
| Grocery list + checks | `mealplan:shared:grocery` | `lib/mealplan/store.ts` |
| Pantry exclusions (grocery) | `mealplan:shared:pantry_exclusions` | `lib/mealplan/pantry.ts` |
| Pantry staples (chat-editable) | `pantry:shared` | `lib/pantry/store.ts` |
| Unit aliases | `mealplan:shared:unit_aliases` | `lib/mealplan/grocery.ts` |
| Named lists | `list:{userId}:{listName}` | `lib/lists/store.ts` |
| List index | `list-index:{userId}` | `lib/lists/index.ts` |
| Category overrides | `category-overrides:shared` | `lib/lists/overrides.ts` |
| Skin log entries | `skinlog:{userId}` | `lib/skinlog/store.ts` |

All Redis access goes through the `getRedisClient()` singleton in `lib/redis/client.ts` (Upstash, env vars: `KV_REST_API_URL`, `KV_REST_API_TOKEN`).

All stores use a **full-replace pattern**: fetch the current value, merge/update, write back. There are no atomic partial updates. Meal plan and pantry keys are shared between users (`shared:`); lists and skin log are per-user.

### Memory and context

Three sources are searched/injected on every `query` intent response:
- **Session turns** (`session:{userId}`) — last 10 turns, 4h TTL, always included as conversation history
- **Pinecone notes** — `searchNotes()` runs speculatively in the Promise.all; results injected as `<memory>` block
- **Redis lists** — `searchUserLists()` runs speculatively in the Promise.all; Haiku picks relevant lists; results injected as `<lists>` block

`generateResponse()` accepts `listContext?: string | null` alongside `contextNotes`. Both blocks are injected into the user message before sending to Sonnet.

**Auto-save:** After every non-dedicated-write exchange, `autoSaveExchange()` (fire-and-forget) asks Haiku whether anything is worth saving. If yes, saves a date-prefixed note to Pinecone (`"April 12, 2026: ..."`) so temporal queries work semantically. Skipped for: `save_note`, `list_write`, `calendar_write`, `web_search`, `staples_update`, `recipe_add`, and all read-only intents.

### Auth

`lib/auth/index.ts` — reads `Authorization: Bearer <token>`, matches against `KEVIN_SECRET` or `KYLIE_SECRET`, returns `"kevin" | "kylie" | null`. All API routes call `authenticateUser(req)` and 401 if null.

### Pinecone (notes/memory)

`lib/pinecone/records.ts` — `saveNote(userId, text)` and `searchNotes(userId, query)`. Namespaces are per-user for private notes (`kevin-notes`, `kylie-notes`) and shared for categories (`shared-restaurants`, `shared-movies`, etc.). The namespace registry is in `lib/pinecone/client.ts`.

### Lists system

`lib/lists/` — general-purpose named lists per user. Key: `list:{userId}:{listName}`.

- `index.ts` — `list-index:{userId}` tracks all list names for a user. Call `addToListIndex()` after every write.
- `search.ts` — `searchUserLists()` for federated query: Haiku picks relevant list names from the index, reads them from Redis, returns formatted string or null.
- `addItem.ts` — `addItemToList()` robust save: always writes to Redis, optionally enriches via TMDb and saves to Pinecone. Enrichment failure never blocks the save. Use for non-grocery single-item adds. `isGroceryList()` and `enrichmentSourceForList()` helpers determine routing.
- `categorize.ts` — Haiku forced tool_use with explicit CATEGORY_MAP; applies shared overrides before calling Haiku.

**Routing in `list_write`:** grocery lists → `handleListWrite` (categorize flow); non-grocery single item → `addItemToList` with TMDb enrichment for watch lists; multi-item non-grocery → `handleListWrite` + `addToListIndex`.

**`movie_query` fallback:** if message matches `/I want to watch .+/i`, routes to `addItemToList` with `listName="watchlist"` before hitting TMDb search.

### Sports (ESPN)

`lib/sports/lookup.ts` — all ESPN API calls. ESPN's public API requires no key. `detectTeam(message)` uses longest-match against the `TEAMS` registry. `findGame()` uses the scoreboard endpoint; schedule/standings/stats use team-specific endpoints that require `teamId` in the registry entry.

### Meal planning

`lib/mealplan/` — full pipeline for the `/mealplan` page:
- `select.ts` — filters recipes (recency, dietary prefs, cuisine + protein variety caps), shuffles to avoid alphabetical bias, then calls `pickMeals()` for final Sonnet selection
- `grocery.ts` — parses `## Ingredients` from recipe markdown, scales by per-meal servings, normalizes units, combines duplicates, categorizes. Single-word unit regex only — avoid multi-word greedy patterns that misparse "2 tbsp sour cream". Pantry-matched items get category `"Pantry Staples"` (shown in their own section at bottom) rather than being filtered out. `COUNT_WORDS` strips meaningless unit words ("unit", "units", "each", "piece", "pieces").
- `pantry.ts` — `getCombinedExclusions()` merges `mealplan:shared:pantry_exclusions` (fixed grocery exclusions) with `pantry:shared` (chat-editable staples) so both sources are reflected in the grocery list.
- `store.ts` — also manages the grocery list (`mealplan:shared:grocery`): `getGroceryList()`, `saveGroceryList()`, `toggleGroceryItem()`, `clearGroceryList()`. The grocery list is cleared automatically when the meal plan is cleared or a new plan is saved.

`/api/mealplan/grocery`: GET builds and caches the list (returns `{ items, checkedItems }`), PATCH toggles a checked item (`{ itemName }`), DELETE clears the cache to force a rebuild.

### UI conventions

- Dark theme: `#000` background, `#111`/`#1a1a1a` cards, `#fff` text, `#888` secondary
- CSS Modules per page/component, no Tailwind (despite SETUP.md — it was not used)
- Client components use `"use client"` + Bearer token stored in `localStorage`
- `components/BottomNav.tsx` drives tab navigation — add new tabs to the `TABS` array

### Skin log

`lib/skinlog/` + `/skinlog` page — per-user daily log for tracking topical products, symptoms, and skin condition ratings (1–5). Entries are stored as a flat array in Redis and grouped by date in the UI. Primarily used by Kylie.

### Audible library sync

One-time (and re-run on new purchases) to seed Kevin's Audible library into Pinecone (`kevin-audible` namespace):

1. **Auth** (first time only) — run in Terminal.app (needs interactive input):
   ```bash
   /Users/Kevin/Library/Python/3.9/bin/audible-quickstart
   # country: us, no encryption, external browser login
   # paste the redirect URL back into the terminal when prompted
   ```

2. **Export library** — run in Terminal.app (auth lives in `~/.audible/`):
   ```bash
   python3 scripts/fetch-audible-library.py > library.json
   ```

3. **Sync to Pinecone** — can run in Claude Code:
   ```bash
   PINECONE_API_KEY=$(grep PINECONE_API_KEY .env.local | cut -d'"' -f2) PINECONE_INDEX_NAME=sonny node scripts/sync-audible.mjs library.json
   ```

4. Delete `library.json` from the repo root after syncing — it's a temp file.

### Deployment

Push to `main` → Vercel auto-deploys. Cron job at `app/api/cron/route.ts` runs Monday 8am (configured in `vercel.json`). Environment variables are managed in the Vercel dashboard.
