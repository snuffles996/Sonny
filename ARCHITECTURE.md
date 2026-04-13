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

Every user interaction enters through `POST /api/chat`:

```
Client (Bearer token)
  → authenticateUser() → "kevin" | "kylie" | 401

  → Promise.all([
      getProfile(userId),           // Redis: profile:{userId}
      getRecentTurns(userId),       // Redis: session:{userId} — last 10 turns, 4h TTL
      classifyIntent(message),      // Haiku forced tool_use → ClassificationResult
      searchNotes(userId, msg),     // Pinecone speculative search → contextNotes
      searchUserLists(userId, msg), // Haiku picks relevant Redis lists → listContext
    ])

  → Pending recommender intercept (if active, short-circuits to note save)

  → switch(intent) → handler
        ↓
    reply: string

  → appendTurn × 2 (user + assistant, sequential to preserve order)

  → fire-and-forget: autoSaveExchange() — Haiku decides if exchange worth saving to Pinecone
    (skipped for intents with dedicated write paths: save_note, list_write, calendar_write,
     web_search, staples_update, recipe_add, and all read-only intents)

  → return { reply, intent, saved, cards? }
  (cards is populated for book_search, book_add, movie_query, movie_add)
```

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
| Sonnet 4.6 | `MODEL` | `generateResponse()`, `selectMeals()`, `runWebSearch()` |
| Haiku 4.5 | `FAST_MODEL` | `classifyIntent()`, `extractEventDetails()`, `extractProfileUpdate()`, `extractRecipeFromUrl()`, `extractSportsQuery()`, `identifySwapTarget()`, `categorizeItems()`, `searchUserLists()`, `autoSaveExchange()`, `extractBookUpdate()`, `extractMovieUpdate()` |

---

## Intent System

Classifier: `lib/anthropic/classify.ts` — Haiku with forced `tool_use`, returns `ClassificationResult`.

`ClassificationResult` carries `intent` + optional fields: `listName`, `items`, `bookTitles`, `movieTitles`, `staplesAction`, `staplesItems`, `correctionItem`, `correctionCategory`.

### Key classifier distinctions

- `list_read` — only for explicit dump requests ("show me / what's on my X list"). Semantic questions about list contents → `query`.
- `movie_query` — lookup/info only. Save intent ("I want to watch X") → `movie_add`.
- `movie_add` — saves to structured `library:shared:movies` Redis store (not the generic list store).
- `book_add` — saves to structured `library:{userId}:books` Redis store.
- `list_write` — grocery lists and generic item lists only. NOT for movies or books.

### All intents

| Intent | Handler | What it does |
|---|---|---|
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
| `mealplan:shared:pantry_exclusions` | `string[]` | shared | `lib/mealplan/pantry.ts` |
| `mealplan:shared:unit_aliases` | `Record<string, string>` | shared | `lib/mealplan/grocery.ts` |
| `pantry:shared` | `string[]` | shared | `lib/pantry/store.ts` |
| `category-overrides:shared` | `Record<string, string>` | shared | `lib/lists/overrides.ts` |
| `list:{userId}:{listName}` | `ListItem[]` | per-user | `lib/lists/store.ts` |
| `list-index:{userId}` | `string[]` of list names | per-user | `lib/lists/index.ts` |
| `skinlog:{userId}` | `SkinLogEntry[]` | per-user | `lib/skinlog/store.ts` |
| `library:{userId}:books` | `Book[]` full array | per-user | `lib/books/store.ts` |
| `library:shared:movies` | `Movie[]` full array | shared | `lib/movies/store.ts` |

All stores use a **full-replace pattern** — fetch current value, merge/update, write back. No atomic partial updates.

### Pantry: two stores, one read path

- `pantry:shared` — chat-editable staples (`staples_update` intent, `lib/pantry/store.ts`)
- `mealplan:shared:pantry_exclusions` — grocery list exclusion overrides (`lib/mealplan/pantry.ts`)
- `getCombinedExclusions()` in `lib/mealplan/pantry.ts` merges both at read time so grocery list reflects both sources

### Pinecone namespace map

| Namespace | Content |
|---|---|
| `kevin-notes` | Kevin's saved notes + auto-saved exchanges |
| `kylie-notes` | Kylie's saved notes |
| `{userId}-search` | Saved web search summaries |
| `shared-restaurants` | Restaurant recommendations |
| `shared-movies` | Movie/TV enriched saves |
| `shared-books` | Book recommendations |
| `kevin-audible` | Kevin's Audible library — legacy fallback only; primary store is now `library:kevin:books` in Redis |

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
- Library pages: `/books` (`app/books/`), `/movies` (`app/movies/`) — list + detail views with inline editing
  - **Books edit mode:** tap any book → "Edit" button in detail header → editable form for status, rating, notes, dateStarted, dateFinished → saves via `PATCH /api/library/books`
  - **Books bulk select:** "Select" button in list header → check multiple books → status picker + Apply in sticky bar → patches all selected in parallel
- Settings page: `/settings` (`app/settings/`) — profile editor backed by `GET/PATCH /api/profile`
- Chat cards: `components/BookCard.tsx`, `components/MovieCard.tsx` — rendered in chat when API returns `cards[]`
- Skin Log page (`/skinlog`) remains functional but is no longer in bottom nav

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
- **`PlannedMeal.mealType`** — extend to support breakfast/lunch/dinner type in meal planning.
- **Kylie's Audible** — `audible_library` intent now searches `library:{userId}:books` automatically per-user. Kylie needs her own Audible export + sync run (`AUDIBLE_USER_ID=kylie node scripts/sync-audible.mjs kylie-library.json`).
- **Admin interface (movies)** — inline edit + bulk select added to `/books`; same pattern not yet applied to `/movies`.
- **Migrate old Pinecone watchlist/book-list entries to Redis stores** — items saved before the structured library existed live in `sharedMovies` / `shared-books` Pinecone namespaces; a one-time migration would surface them in the `/books` and `/movies` pages.
- **Book cover fallback quality** — Open Library coverage is incomplete. Consider adding a Google Books cover URL (available in the `searchBooks()` response via `info.imageLinks.thumbnail`) as a secondary source.

### Infrastructure

- **iCloud Reminders** — CloudKit-only; not accessible via CalDAV. Needs native Apple framework or HomeKit/Shortcuts bridge.
- **Auto-save quality tuning** — Haiku decides what's notable on every non-write exchange. May produce noise over time; consider a confidence threshold or periodic Pinecone dedup pass.
- **Pantry store unification** — `pantry:shared` and `mealplan:shared:pantry_exclusions` are merged at read time via `getCombinedExclusions()` but remain two separate write paths. A future pass could consolidate to one store.
- **Web search save reliability** — fire-and-forget `decideSave` can be dropped on Vercel function timeout; no retry mechanism.

### Open questions

- Kylie full onboarding: `KYLIE_SECRET`, profile seed, Audible library sync, skin log introduction.
