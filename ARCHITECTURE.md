# Sonny — Architecture & System Overview

*Personal AI assistant for Kevin + Kylie. Next.js 14 App Router, deployed on Vercel.*

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 App Router, TypeScript strict mode |
| AI | Anthropic SDK (direct — not AI SDK). Sonnet 4.6 for responses, Haiku 4.5 for extraction |
| Vector store | Pinecone — notes, recipes, movies, books, Audible library |
| Key-value store | Upstash Redis (via `@upstash/redis`) |
| Calendar | iCloud CalDAV (manual redirect-safe client) |
| Sports data | ESPN public API (no key required) |
| Movie/TV data | TMDb API (`TMDB_API_KEY`) |
| Book data | Google Books API (no key required) |
| Deployment | Vercel — push to `main` auto-deploys |

---

## Request Flow

Every user interaction enters through `POST /api/chat`. The handler supports two paths:

```
Client (Bearer token)
  → authenticateUser() → "kevin" | "kylie" | 401

  → body: { message, confirmAction? }

  ── Confirm path (early return) ────────────────────────────────────────────
  → if confirmAction present → executeConfirmedAction(action, userId)
      (no session persist — confirmed turns don't consume the 10-turn window)
  → return { reply }

  ── Normal path ────────────────────────────────────────────────────────────
  → Promise.all([
      getProfile(userId),           // Redis: profile:{userId}
      getRecentTurns(userId),       // Redis: session:{userId} — last 10 turns, 4h TTL
      classifyIntent(message),      // Haiku forced tool_use → ClassificationResult (+ confidence)
      loadBroadContext(userId, msg),// Pinecone embed + parallel namespace queries + Redis libraries
    ])

  → STRUCTURAL_INTENTS fast path (high-confidence only):
      if intent is structural (calendar, sports, recipe_add, meal_plan_*, etc.)
      AND confidence is "high" → existing switch(intent) → handler → reply

  → CONVERSATIONAL fallback (everything else):
      generateConversationalResponse({ userId, message, profile, recentTurns, broadContext })
        → Anthropic tool_use: model responds + optionally calls propose_action tool
        → returns { reply, pendingAction? }

  → appendTurn × 2 (user + assistant, sequential)

  → fire-and-forget: autoSaveExchange()
    (skipped for structural writes and when pendingAction is non-library type)

  → return { reply, intent, pendingAction? }
```

### Confirm flow

When the user taps "Confirm" in the UI, the client POSTs `{ confirmAction: PendingAction }`. The route early-returns after `executeConfirmedAction()` without persisting turns to keep the session window clean. Auto-save still runs for library actions (movie_add, book_add, etc.) to capture user commentary.

---

## Memory Architecture

Three sources feed into every `query` response:

| Source | Key / Location | Injected as |
|---|---|---|
| Session turns | `session:{userId}` — last 10, 4h TTL | Prior conversation messages |
| Pinecone notes | `kevin-notes` / `kylie-notes` + shared namespaces | `<memory>` block in user message |
| Redis lists | `list:{userId}:{listName}` via `list-index:{userId}` | `<lists>` block in user message |

**Auto-save:** `lib/notes/autoSave.ts` — fire-and-forget after each exchange. Haiku decides if anything is worth persisting. If yes, saves a date-prefixed note: `"April 12, 2026: Kevin mentioned..."`. Date in the text makes temporal queries (`"what did I mention last week"`) work via semantic search.

**System prompt rule:** Sonny is told that `<memory>` and `<lists>` blocks contain real stored data. It must never disclaim them as hallucinations. During `generateResponse()` (a pure text generation step), no writes can occur — Sonny must ask the user to confirm before claiming to have added something.

---

## Dual-Model Pattern

All extraction/classification uses **Haiku with forced `tool_use`** — every Haiku call specifies `tool_choice: { type: "tool", name: "..." }` with a required input schema. This is the convention for all new extraction functions.

| Model | Constant | Used for |
|---|---|---|
| Sonnet 4.6 | `MODEL` | `generateConversationalResponse()`, `selectMeals()`, `runWebSearch()` |
| Haiku 4.5 | `FAST_MODEL` | `classifyIntent()`, `extractEventDetails()`, `extractProfileUpdate()`, `extractRecipeFromUrl()`, `extractSportsQuery()`, `identifySwapTarget()`, `categorizeItems()`, `searchUserLists()`, `autoSaveExchange()`, `extractBookUpdate()`, `extractMovieUpdate()` |

---

## Conversational System

### New files

| File | Purpose |
|---|---|
| `lib/anthropic/actions.ts` | `ActionType` union, `PendingAction` interface, `parsePendingAction()`, `stripActionBlock()` |
| `lib/anthropic/context.ts` | `BroadContext` interface + `loadBroadContext()` — single embed, parallel Pinecone queries + full Redis movie/book libraries |
| `lib/anthropic/execute.ts` | `executeConfirmedAction(action, userId)` — maps `ActionType` to store operations. Includes `titlesRoughlyMatch()` (50% word overlap guard before TMDb add). |

### `BroadContext`

`loadBroadContext(userId, message)` embeds the message once, then runs in parallel:
- Pinecone: notes, restaurants, recipes (per-user + shared namespaces)
- Redis: `getMovies()` (full library), `getBooks(userId)` (full library), `getActivePlan()`

The full movie and book libraries are injected into the conversational system prompt so Sonny can answer "have I seen X" / "am I reading X" without a separate lookup.

### `propose_action` tool

`generateConversationalResponse()` uses Anthropic tool_use (`tool_choice: "auto"`) with a single `propose_action` tool. Claude can emit a text reply AND call the tool in the same turn. The tool call is structurally enforced — more reliable than parsing `<action>` JSON blocks from free text.

```ts
ActionType = "save_note" | "list_write" | "list_add_item" | "calendar_write"
           | "movie_update" | "movie_add" | "movie_remove"
           | "book_update"  | "book_add"  | "book_remove"
           | "recipe_add"
```

`confirmationRequired: false` — for explicit statements ("I finished X", "I'm watching X"): auto-execute immediately.
`confirmationRequired: true` — for ambiguous/query messages: show Confirm button to user.

### Classifier changes

`classifyIntent()` now also returns `confidence: "high" | "low"`. Structural intents only take the fast path when confidence is high. Low-confidence or `conversational` intent always falls through to `generateConversationalResponse()`.

## Intent System

Classifier: `lib/anthropic/classify.ts` — Haiku with forced `tool_use`, returns `ClassificationResult`.

`ClassificationResult` carries `intent` + `confidence` + optional fields: `listName`, `items`, `bookTitles`, `movieTitles`, `staplesAction`, `staplesItems`, `correctionItem`, `correctionCategory`.

### Key classifier distinctions

- `list_read` — only for explicit dump requests ("show me / what's on my X list"). Semantic questions about list contents → `query`.
- `movie_query` — lookup/info only. Save intent ("I want to watch X") → `movie_add`.
- `movie_add` — saves to structured `library:shared:movies` Redis store (not the generic list store).
- `book_add` — saves to structured `library:{userId}:books` Redis store.
- `list_write` — grocery lists and generic item lists only. NOT for movies or books.

### All intents

| Intent | Handler | What it does |
|---|---|---|
| `conversational` | `lib/anthropic/respond.ts` | **Default path** — `generateConversationalResponse()` with full BroadContext + propose_action tool |
| `save_note` | route.ts inline | Pinecone upsert; checks for pending recommender follow-up |
| `query` | `lib/anthropic/respond.ts` | RAG: Pinecone + Redis list context → Sonnet response |
| `web_search` | `lib/search/webSearch.ts` | Anthropic server-side `web_search_20260209` tool |
| `calendar_read` | route.ts inline | CalDAV `getUpcomingEvents()` |
| `calendar_write` | route.ts inline | Haiku extracts event details → CalDAV `createEvent()` |
| `profile_update` | route.ts inline | Haiku extracts fields → `saveProfile()` |
| `recipe_add` | route.ts inline | Haiku extracts URL → fetch + parse → Redis |
| `sports_query` | route.ts inline | ESPN next game |
| `sports_score` | route.ts inline | ESPN game score |
| `sports_schedule` | route.ts inline | ESPN upcoming games |
| `sports_standings` | route.ts inline | ESPN standings |
| `sports_player_stats` | route.ts inline | ESPN player stats |
| `sports_calendar_bulk` | route.ts inline | ESPN full schedule → CalDAV bulk create |
| `meal_plan_create` | route.ts inline | `selectMeals()` → Sonnet picks → saves plan |
| `meal_plan_swap` | route.ts inline | Haiku identifies swap target → replaces meal |
| `meal_plan_grocery` | route.ts inline | `buildGroceryList()` → formatted text |
| `meal_plan_clear` | route.ts inline | Clears plan + grocery list from Redis |
| `book_search` | route.ts inline | Google Books API search; returns `cards[]` with "Add to library" actions |
| `book_add` | route.ts inline | Google Books lookup → save to `library:{userId}:books`; returns `cards[]` |
| `book_update` | route.ts inline | Haiku extraction → find in Redis library → update status/rating/notes/dates |
| `audible_library` | route.ts inline | Redis `library:{userId}:books` (source=audible) first; falls back to Pinecone |
| `movie_query` | route.ts inline | TMDb search + Redis library check; returns `cards[]` with "Add to watchlist" actions |
| `movie_add` | route.ts inline | TMDb lookup + streaming providers → save to `library:shared:movies`; returns `cards[]` |
| `movie_update` | route.ts inline | Haiku extraction → find in Redis library → update status/rating/progress |
| `library_stats` | route.ts inline | Count books + movies by status from Redis stores |
| `list_write` | `lib/lists/handler.ts` + `lib/lists/addItem.ts` | Grocery lists → categorize flow; non-grocery single item → `addItemToList`. No longer handles movies/books. |
| `list_read` | `lib/lists/handler.ts` | Raw list dump by name; no listName → scan all via `list-index:{userId}` |
| `categorization_correction` | route.ts inline | Saves shared override → `category-overrides:shared` |
| `staples_update` | route.ts inline | Add/remove from `pantry:shared` |
| `staples_read` | route.ts inline | Returns `pantry:shared` list |

---

## Data Storage

### Redis key map

| Key | Type | Owner | File |
|---|---|---|---|
| `profile:{userId}` | `UserProfile` | per-user | `lib/profile/store.ts` |
| `session:{userId}` | `Turn[]` (last 10, 4h TTL) | per-user | `lib/session/kv.ts` |
| `data:recipes` | `Recipe[]` full array | shared | `lib/recipes/store.ts` |
| `mealplan:shared:active` | `MealPlan` | shared | `lib/mealplan/store.ts` |
| `mealplan:shared:history` | `MealPlan[]` | shared | `lib/mealplan/store.ts` |
| `mealplan:shared:grocery` | `{ items, checkedItems }` | shared | `lib/mealplan/store.ts` |
| `mealplan:shared:unit_aliases` | `Record<string, string>` | shared | `lib/mealplan/grocery.ts` |
| `pantry:shared` | `string[]` | shared | `lib/pantry/store.ts` |
| `category-overrides:shared` | `Record<string, string>` | shared | `lib/lists/overrides.ts` |
| `list:{userId}:{listName}` | `ListItem[]` | per-user | `lib/lists/store.ts` |
| `list-index:{userId}` | `string[]` of list names | per-user | `lib/lists/index.ts` |
| `skinlog:{userId}` | `SkinLogEntry[]` | per-user | `lib/skinlog/store.ts` |
| `library:{userId}:books` | `Book[]` full array | per-user | `lib/books/store.ts` |
| `library:shared:movies` | `Movie[]` full array | shared | `lib/movies/store.ts` |

All stores use a **full-replace pattern** — fetch current value, merge/update, write back. No atomic partial updates.

### Pantry

Single source of truth: `pantry:shared` via `lib/pantry/store.ts`. All write paths (chat `staples_update`, `/api/pantry`, `/api/mealplan/exclusions`) resolve to `addStaples`/`removeStaples`. `lib/mealplan/pantry.ts` is a thin wrapper that preserves existing call sites. On first read after deploy, `getPantryStaples()` lazily migrates any data from the legacy `mealplan:shared:pantry_exclusions` key into `pantry:shared` and deletes the old key.

### Pinecone namespace map

| Namespace | Content |
|---|---|
| `kevin-notes` | Kevin's saved notes + auto-saved exchanges |
| `kylie-notes` | Kylie's saved notes |
| `{userId}-search` | Saved web search summaries |
| `shared-restaurants` | Restaurant recommendations |
| `shared-recipes` | Recipe/food notes |
| `shared-travel` | Travel notes |
| `kevin-audible` | Kevin's Audible library |

---

## Feature Modules

### Lists — `lib/lists/`

General-purpose named lists per user. Key: `list:{userId}:{listName}`.

- **`store.ts`** — CRUD with deduplication. `getAllListNames()` scans `list:{userId}:*` keys.
- **`index.ts`** — `list-index:{userId}` tracks all list names. Call `addToListIndex()` after every write so `searchUserLists()` can enumerate without key scanning.
- **`search.ts`** — `searchUserLists(userId, query)`: loads index, Haiku picks relevant list names, reads those lists from Redis, returns formatted string or null. Runs speculatively in the main Promise.all.
- **`addItem.ts`** — `addItemToList()`: always writes to Redis first, optionally tries TMDb enrichment for watch-list items, saves enriched note to Pinecone if successful. Enrichment failure never blocks the Redis save. Helpers: `isGroceryList()`, `enrichmentSourceForList()`.
- **`categorize.ts`** — Haiku forced `tool_use` with explicit `CATEGORY_MAP`; applies shared overrides before Haiku.
- **`overrides.ts`** — shared category override store.
- **`handler.ts`** — formats `list_write` / `list_read` responses grouped by category.

**`list_write` routing:**
1. Grocery list name → `handleListWrite` (categorize + confirm) + `addToListIndex`
2. Non-grocery, single item → `addItemToList` (enrichment aware)
3. Non-grocery, multiple items → `handleListWrite` + `addToListIndex`

### Meal Planning — `lib/mealplan/`

1. **`select.ts`** — filters recipes (excludes last-14-day recency, dietary prefs, active plan dupes), applies cuisine + protein variety caps, shuffles, calls Sonnet to pick final meals
2. **`grocery.ts`** — parses `## Ingredients` from recipe markdown, scales by servings, loads unit aliases from Redis, normalizes units, deduplicates, categorizes. `COUNT_WORDS` set strips meaningless unit words ("unit", "units", "each", "piece", "pieces"). Items matching combined exclusions list get category `"Pantry Staples"`.
3. **`pantry.ts`** — `getCombinedExclusions()` merges both pantry sources for grocery list generation
4. **`store.ts`** — active plan, history, grocery list CRUD. Grocery list auto-clears on plan clear or new plan

**Meal plan API:** `GET /api/mealplan` (active plan), `POST` (create/replace), `DELETE` (clear + archive). `PATCH` handles four operations keyed by body fields:
- `{ slug, made, notes? }` — check off a meal
- `{ slug, servings }` — adjust per-meal serving count
- `{ slug, replacementSlug }` — swap a meal
- `{ removeMealSlug }` — remove one meal from plan (no `slug` required)
- `{ addSlug }` — append a recipe to the existing plan (no `slug` required)

**Grocery list API:** `GET /api/mealplan/grocery` (build + cache), `PATCH` (toggle checked item), `DELETE` (force rebuild)

### Auto-Save — `lib/notes/autoSave.ts`

`autoSaveExchange(userId, userMessage, assistantReply, dateLabel)` — Haiku forced `tool_use` decides if anything notable happened. If yes, saves `"April 12, 2026: [summary]"` to Pinecone. Fire-and-forget — never blocks response. Date prefix enables temporal semantic search.

### Web Search — `lib/search/`

- **`webSearch.ts`** — single Anthropic API call with `web_search_20260209` tool. Server-side: Anthropic handles all search execution internally, model can search multiple times, always returns `end_turn`. Returns `{ responseText, query, sourceUrls, searchCount }`.
- **`saveDecision.ts`** + **`store.ts`** — Haiku decides whether to save result; fire-and-forget from route.ts.

### CalDAV / Calendar — `lib/caldav/`

- All requests go through `calFetch()` — manually follows redirects, re-attaches `Authorization` header. **Never use raw `fetch()` for CalDAV.**
- `events.ts` — `getUpcomingEvents()`, `createEvent()`, `checkDuplicates()`
- ICS subscription calendars supported via `ICS_SUBSCRIPTIONS` env var
- **iCloud Reminders: not accessible** — Apple's personal Reminders use CloudKit, not CalDAV

### Sports — `lib/sports/`

`lookup.ts` — `TEAMS` registry with `teamId` per team, `detectTeam()` (longest-match), ESPN endpoint wrappers. No API key required.

### Recipes — `lib/recipes/`

Stored as `Recipe[]` in Redis (`data:recipes`) — full array, full-replace. `extract.ts` — Haiku extracts structured recipe from URL: title, `## Ingredients` + `## Instructions` markdown, totalTime, servings, cuisine, tags.

`Recipe` fields include `mealType?: RecipeMealType` (`"breakfast" | "lunch" | "dinner" | "snack" | "dessert"`, defaults to `"dinner"` when absent). All existing recipes without the field are treated as dinner at read time.

API: `GET /api/recipes` (list all), `DELETE /api/recipes?slug=` (remove one). `store.ts` exports `removeRecipe(slug)`. `/api/recipes/add` accepts `mealType` in the recipe body.

### Profile — `lib/profile/`

`UserProfile` fields: `userId`, `homeLocation`, `workLocation`, `commuteCorridor`, `hobbiesAndInterests[]`, `dietaryPreferences[]`, `standingContext`, `updatedAt`. Loaded on every request, injected into all system prompts.

### Session — `lib/session/`

Last 10 turns per user, 4h TTL. Every `generateResponse()` call receives recent turns as prior messages.

### Skin Log — `lib/skinlog/`

Per-user daily log (`skinlog:{userId}`) — topical products, symptoms, skin condition rating 1–5. UI at `/skinlog`, grouped by date. Primarily Kylie.

---

## UI

- Dark theme: `#000` bg, `#111`/`#1a1a1a` cards, `#fff` text, `#888` secondary
- CSS Modules per page/component — no Tailwind
- `"use client"` components store Bearer token in `localStorage`
- Bottom nav: `components/BottomNav.tsx` — 3 tabs: Menu (Grid2x2), Chat (MessageCircle), Meals (UtensilsCrossed). Uses `lucide-react` icons.
- Menu overlay: `components/MenuOverlay.tsx` — slide-up sheet with Settings row + Library section (Books, Movies & TV, Recipes)
- Library pages: `/books` (`app/books/`), `/movies` (`app/movies/`) — list + detail views with inline editing and bulk select
  - **Edit mode (both):** tap any item → "Edit" button in detail header → editable form → saves via `PATCH /api/library/books` or `PATCH /api/library/movies`
    - Books: status, rating, notes, dateStarted, dateFinished + **Remove** button → `DELETE /api/library/books?id=`
    - Movies: status, rating, notes, dateWatched + **Remove** button → `DELETE /api/library/movies?id=`
  - **Bulk select (both):** "Select" button in list header → check multiple items → opt-in field chips (Status, Rating, Date) → "Apply" → single atomic write via bulk endpoint. Also **Remove** button → parallel individual DELETEs.
- Settings page: `/settings` (`app/settings/`) — profile editor backed by `GET/PATCH /api/profile`
- Chat cards: `components/BookCard.tsx`, `components/MovieCard.tsx` — rendered in chat when API returns `cards[]`
- **Recipes page** (`/recipes`): recipe detail sheet has a **Remove** button → `DELETE /api/recipes?slug=`
- **Meal plan page** (`/mealplan`): each `MealPlanCard` has a × remove button → `PATCH /api/mealplan { removeMealSlug }`. Header has **+ Add meal** → `AddMealModal` → `PATCH /api/mealplan { addSlug, mealType }`. `PlanMealsModal` renamed to "New plan" to distinguish from add-single-meal flow.
- **`components/AddMealModal.tsx`** — Breakfast/Lunch/Dinner type picker (defaults to Dinner). Filters available recipes by `recipe.mealType ?? "dinner"`. Passes `mealType` through to the PATCH. Auto-generated plans stamp all meals `mealType: "dinner"`. The meal list groups by type (Breakfast → Lunch → Dinner) with section headers when multiple types are present.
- **Recipe form** (`/recipes` Add/Edit sheet) — Breakfast/Lunch/Dinner picker sets `recipe.mealType`. Defaults to Dinner for all new entries.
- Skin Log page (`/skinlog`) remains functional but is no longer in bottom nav

---

## Remote MCP Server

`app/api/mcp/route.ts` — Streamable HTTP MCP server compatible with claude.ai Settings → Connectors and Claude Desktop remote connector support.

### Transport

Uses `WebStandardStreamableHTTPServerTransport` from `@modelcontextprotocol/sdk`. Stateless — a fresh `Server` + `Transport` pair is created per request (correct for Vercel serverless; no session persistence).

### Auth

Accepts auth from either:
- `Authorization: Bearer <token>` header (Claude Desktop, API clients)
- `?token=<token>` query parameter (claude.ai connector UI, which only supports OAuth2 or URL-embedded tokens)

Both resolve via the same `KEVIN_SECRET` / `KYLIE_SECRET` env vars as the rest of the API. Auth is checked in all three handlers (POST, GET, DELETE).

### Route handlers

| Method | Purpose |
|---|---|
| `POST` | JSON-RPC: `initialize`, `tools/list`, `tools/call` |
| `GET` | SSE stream for server-to-client push (stateless — SDK handles it) |
| `DELETE` | Session termination (stateless — returns 204) |

### Tools (25)

| Tool | Backed by |
|---|---|
| `sonny_search_notes` | Pinecone `{userId}-notes` |
| `sonny_save_note` | Pinecone `{userId}-notes` |
| `sonny_get_meal_plan` | Redis `mealplan:shared:active` |
| `sonny_create_meal_plan` | `selectMeals()` → Redis |
| `sonny_swap_meal` | `identifySwapTarget()` + `selectMeals()` |
| `sonny_get_grocery_list` | `buildGroceryList()` + Redis cache |
| `sonny_add_recipe` | `extractRecipeFromUrl()` → Redis |
| `sonny_list_recipes` | Redis `data:recipes` |
| `sonny_get_calendar` | CalDAV `getUpcomingEvents()` |
| `sonny_create_event` | CalDAV `createEvent()` |
| `sonny_get_pantry` | Redis `pantry:shared` |
| `sonny_update_pantry` | Redis `pantry:shared` |
| `sonny_get_books` | Redis `library:{userId}:books` — supports optional `status` filter |
| `sonny_add_book` | Google Books lookup → Redis `library:{userId}:books`. Falls back to manual entry if lookup fails and `author` is provided. Full schema: title, author, status, year, isbn, coverUrl, series, seriesPosition, source, tags, rating, notes, dateStarted, dateFinished. |
| `sonny_update_book` | Fuzzy title match → patch status/rating/notes/dates in Redis |
| `sonny_get_movies` | Redis `library:shared:movies` — supports optional `status` + `type` filters |
| `sonny_add_movie` | TMDb lookup → Redis `library:shared:movies`. Falls back to manual entry if lookup fails and `type` is provided. Full schema: title, type, status, year, coverUrl, director, streamingOn, seasons, runtime, rating, notes, currentSeason, currentEpisode, dateWatched. |
| `sonny_update_movie` | Fuzzy title match → patch status/rating/notes/season/episode in Redis |
| `sonny_search_audible` | Pinecone `kevin-audible` |
| `sonny_web_search` | Anthropic `web_search_20260209` |
| `sonny_list_all_lists` | Redis `list-index:{userId}` — enumerate all list names before fetching |
| `sonny_get_list` | Redis `list:{userId}:{listName}` |
| `sonny_update_list` | Redis `list:{userId}:{listName}` + `list-index:{userId}` |
| `sonny_get_profile` | Redis `profile:{userId}` |
| `sonny_update_profile` | Haiku extraction → Redis `profile:{userId}` |
| `sonny_sports_next` | ESPN next game |
| `sonny_sports_score` | ESPN recent score |
| `sonny_sports_standings` | ESPN standings |

### Connector setup (claude.ai)

Settings → Connectors → Add Custom Connector:
- **URL:** `https://sonny-snuffles996s-projects.vercel.app/api/mcp?token=YOUR_SECRET`
- No OAuth fields needed

After changing the tool list, users must re-sync the connector in claude.ai to pick up new tools.

---

## Cron

`app/api/cron/route.ts` runs Monday 8am (`vercel.json` schedule: `0 8 * * 1`). Currently a stub — intended to send weekly meal plan + calendar briefing to Kevin and Kylie.

---

## Scripts

| Script | Purpose |
|---|---|
| `scripts/sync-audible.mjs` | Sync Audible library JSON → Redis `library:kevin:books` (upserts by ASIN; never overwrites user-set fields; all new books default to `status: "shelf"` — Audible API does not expose listening progress) |
| `scripts/fetch-audible-library.py` | Export Audible library to JSON (requires `audible-quickstart` auth) |
| `scripts/normalize-recipe-units.mjs` | Normalize unit names in all stored recipes — unicode fractions, fl oz, long-form units. Run with `--dry-run` first. |
| `scripts/import-vault.mjs` | One-time import of notes from an Obsidian vault |
| `scripts/fetch-team-ids.mjs` | Utility for ESPN team ID lookup |

---

## Environment Variables

| Variable | Used by |
|---|---|
| `ANTHROPIC_API_KEY` | All Haiku + Sonnet calls |
| `KV_REST_API_URL` | Upstash Redis |
| `KV_REST_API_TOKEN` | Upstash Redis |
| `PINECONE_API_KEY` | Pinecone reads/writes |
| `PINECONE_INDEX_NAME` | Pinecone index name |
| `KEVIN_SECRET` | Auth bearer token |
| `KYLIE_SECRET` | Auth bearer token |
| `TMDB_API_KEY` | TMDb movie/TV search + watchlist enrichment |
| `CALDAV_USERNAME` | iCloud CalDAV |
| `CALDAV_PASSWORD` | iCloud app-specific password |
| `CALDAV_READ_CALENDARS` | Comma-separated calendar display names to read |
| `CALDAV_WRITE_CALENDAR` | Calendar display name to write events to |
| `ICS_SUBSCRIPTIONS` | `"Name=url,..."` for ICS subscription calendars |
| `DEFAULT_SERVINGS` | Default meal servings (falls back to `2`) |

---

## Open Items

### Features

- **Weekly briefing cron** — stub at `app/api/cron/route.ts`; send meal plan + calendar summary Monday 8am to Kevin and Kylie.
- ~~**`PlannedMeal.mealType`**~~ — Resolved: `PlannedMeal` has `mealType?: MealType`; `Recipe` has `mealType?: RecipeMealType`. Types: `breakfast | lunch | dinner | snack | dessert`. Auto-generated meals are stamped `"dinner"`. AddMealModal filters recipes by type. Meal list groups by type with section headers (Breakfast → Lunch → Dinner → Snack → Dessert). Legacy data without the field defaults to `"dinner"` at render time.
- **Kylie's Audible** — `audible_library` intent now searches `library:{userId}:books` automatically per-user. Kylie needs her own Audible export + sync run (`AUDIBLE_USER_ID=kylie node scripts/sync-audible.mjs kylie-library.json`).
- ~~**Book cover fallback quality**~~ — Already implemented: `searchBooks()` returns `coverUrl` from `info.imageLinks.thumbnail`; all handlers use `top.coverUrl ?? openlibrary` (Google Books primary, Open Library fallback by ISBN). TMDb poster coverage for movies/TV is near-complete, no fallback needed.
- ~~**Recipe from photo**~~ — Implemented: `Recipe` type now has `photoUrl?: string`. `/api/recipes/add` accepts `{ url }` OR `{ recipe: { name, content, cuisine, ... } }`. `/api/recipes/upload-photo` uploads to Vercel Blob and returns a public URL. `sonny_add_recipe` MCP tool accepts either URL or structured fields. Recipe detail sheets display the photo when present. Workflow: user sends photo to claude.ai → Claude extracts data → calls `sonny_add_recipe` with structured fields + optional `photoUrl`.
- ~~**Manual shopping list items**~~ — Implemented: `manualItems: string[]` added to `StoredGrocery` (persists across rebuilds). `POST /api/mealplan/grocery` adds an item; `PATCH { removeManual }` removes one. Grocery page shows a "My Items" section at top with an inline add input and × remove buttons. Manual items survive plan swaps and rebuilds.
- **Multi-user list sharing (future)** — Currently recipes and meal plan are globally shared (`shared:` prefix); books and lists are per-user. Future: explicit share relationships so Kevin could share a recipe collection with his parents while they maintain their own independent meal plan. For now: manually combine/separate via Claude Code. Architecture decision deferred — needs a share graph in Redis and a per-resource permission model.
- **Auth improvements (future)** — Current auth is static bearer tokens (`KEVIN_SECRET`, `KYLIE_SECRET`) in env vars. Desired: username/password login with change-password flow and self-serve account creation. Would replace or wrap the existing Bearer token check in `lib/auth/index.ts`. Requires a credential store (hashed passwords in Redis or a managed auth provider like Clerk). Deferred until user base grows beyond Kevin + Kylie.

### Infrastructure

- **iCloud Reminders** — CloudKit-only; not accessible via CalDAV. Needs native Apple framework or HomeKit/Shortcuts bridge.
- ~~**Auto-save quality tuning**~~ — Resolved: `save_decision` tool schema now includes `confidence: "high" | "low"`; only saves when both `should_save` and `confidence === "high"`. Reduces borderline noise.
- ~~**Pantry store unification**~~ — Resolved: single `pantry:shared` key; `lib/mealplan/pantry.ts` is now a thin wrapper. Lazy migration absorbs `mealplan:shared:pantry_exclusions` on first read.
- ~~**Web search save reliability**~~ — Resolved: both `decideSave` (web search) and `autoSaveExchange` now use `waitUntil()` from `@vercel/functions`, keeping the function alive after the response is sent.

### Open questions

- Kylie full onboarding: `KYLIE_SECRET`, profile seed, Audible library sync, skin log introduction.
