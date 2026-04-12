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
| Deployment | Vercel — push to `main` auto-deploys |

---

## Request Flow

Every user interaction enters through `POST /api/chat`:

```
Client (Bearer token)
  → authenticateUser() → "kevin" | "kylie" | 401

  → Promise.all([
      getProfile(userId),        // Redis: profile:{userId}
      getRecentTurns(userId),    // Redis: session:{userId} — last 5 turns
      classifyIntent(message),   // Haiku forced tool_use → ClassificationResult
      searchNotes(userId, msg),  // Pinecone speculative search
    ])

  → Pending recommender intercept (if active, short-circuits to note save)

  → switch(intent) → handler
        ↓
    reply: string

  → appendTurn × 2 (user + assistant, sequential to preserve order)
  → return { reply, intent, saved }
```

---

## Dual-Model Pattern

All extraction/classification uses **Haiku with forced `tool_use`** — every Haiku call specifies `tool_choice: { type: "tool", name: "..." }` with a required input schema. This is the convention for all new extraction functions.

| Model | Constant | Used for |
|---|---|---|
| Sonnet 4.6 | `MODEL` | `generateResponse()`, `selectMeals()`, `runWebSearch()` |
| Haiku 4.5 | `FAST_MODEL` | `classifyIntent()`, `extractEventDetails()`, `extractProfileUpdate()`, `extractRecipeFromUrl()`, `extractSportsQuery()`, `identifySwapTarget()`, `categorizeItems()` |

---

## Intent System

Classifier: `lib/anthropic/classify.ts` — Haiku with forced `tool_use`, returns `ClassificationResult`.

`ClassificationResult` carries `intent` + optional fields: `listName`, `items`, `staplesAction`, `staplesItems`, `correctionItem`, `correctionCategory`.

### All intents

| Intent | Handler | What it does |
|---|---|---|
| `save_note` | route.ts inline | Pinecone upsert; checks for pending recommender follow-up |
| `query` | `lib/anthropic/respond.ts` | RAG: Pinecone context → Sonnet response |
| `web_search` | `lib/search/webSearch.ts` | Anthropic server-side `web_search_20260209` tool (single call, model searches internally) |
| `calendar_read` | route.ts inline | CalDAV `getUpcomingEvents()` |
| `calendar_write` | route.ts inline | Haiku extracts event details → CalDAV `createEvent()` |
| `profile_update` | route.ts inline | Haiku extracts fields → `saveProfile()` |
| `recipe_add` | route.ts inline | Haiku extracts URL → fetch + parse → Pinecone + Redis |
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
| `book_search` | route.ts inline | Pinecone semantic search (`shared-books` namespace) |
| `audible_library` | route.ts inline | Pinecone semantic search (`kevin-audible` namespace) |
| `movie_query` | route.ts inline | Pinecone semantic search (`shared-movies` namespace) |
| `list_write` | `lib/lists/handler.ts` | Haiku categorizes items → Redis list store |
| `list_read` | `lib/lists/handler.ts` | Reads Redis list grouped by category |
| `categorization_correction` | route.ts inline | Saves shared override → `category-overrides:shared` |
| `staples_update` | route.ts inline | Add/remove from `pantry:shared` |
| `staples_read` | route.ts inline | Returns `pantry:shared` list |

---

## Data Storage

### Redis key map

| Key | Type | Owner | File |
|---|---|---|---|
| `profile:{userId}` | `UserProfile` | per-user | `lib/profile/store.ts` |
| `session:{userId}` | `Turn[]` (last 5, 4h TTL) | per-user | `lib/session/kv.ts` |
| `data:recipes` | `Recipe[]` full array | shared | `lib/recipes/store.ts` |
| `mealplan:shared:active` | `MealPlan` | shared | `lib/mealplan/store.ts` |
| `mealplan:shared:history` | `MealPlan[]` | shared | `lib/mealplan/store.ts` |
| `mealplan:shared:grocery` | `{ items, checkedItems }` | shared | `lib/mealplan/store.ts` |
| `mealplan:shared:pantry_exclusions` | `string[]` | shared | `lib/mealplan/pantry.ts` |
| `mealplan:shared:unit_aliases` | `Record<string, string>` | shared | `lib/mealplan/grocery.ts` |
| `pantry:shared` | `string[]` | shared | `lib/pantry/store.ts` |
| `category-overrides:shared` | `Record<string, string>` | shared | `lib/lists/overrides.ts` |
| `list:{userId}:{listName}` | `ListItem[]` | per-user | `lib/lists/store.ts` |
| `skinlog:{userId}` | `SkinLogEntry[]` | per-user | `lib/skinlog/store.ts` |

All stores use a **full-replace pattern** — fetch current value, merge/update, write back. No atomic partial updates.

### Pinecone namespace map

| Namespace | Content |
|---|---|
| `kevin-notes` | Kevin's saved notes |
| `kylie-notes` | Kylie's saved notes |
| `shared-restaurants` | Restaurant recommendations |
| `shared-movies` | Movie/TV recommendations |
| `shared-books` | Book recommendations |
| `kevin-audible` | Kevin's Audible library (one-time sync via `scripts/sync-audible.mjs`) |

---

## Feature Modules

### Meal Planning — `lib/mealplan/`

1. **`select.ts`** — filters recipes (excludes last-14-day recency, dietary prefs, active plan dupes), applies cuisine + protein variety caps, shuffles to avoid alphabetical bias, calls Sonnet to pick final meals
2. **`grocery.ts`** — parses `## Ingredients` from recipe markdown, scales by servings, loads unit aliases from Redis (`mealplan:shared:unit_aliases`, fallback to `DEFAULT_UNIT_ALIASES`), normalizes units, deduplicates, categorizes. Items matching the pantry exclusions list get category `"Pantry Staples"` (shown in their own section, not removed)
3. **`pantry.ts`** — shared grocery-exclusion list (`mealplan:shared:pantry_exclusions`), used exclusively in grocery list generation
4. **`store.ts`** — active plan, history, grocery list CRUD. Grocery list auto-clears on plan clear or new plan creation

**Grocery list API:** `GET /api/mealplan/grocery` (build + cache), `PATCH` (toggle checked item), `DELETE` (force rebuild)

### Lists — `lib/lists/`

General-purpose named lists per user. Key: `list:{userId}:{listName}`.

- **`store.ts`** — CRUD with deduplication on write
- **`categorize.ts`** — Haiku forced `tool_use` with explicit `CATEGORY_MAP`; applies shared overrides before Haiku to short-circuit known corrections. Categories: Produce, Bakery, Meat & Seafood, Dairy & Eggs, Frozen, Pantry, Beverages, Snacks, Personal Care, Household, Baby & Pet
- **`overrides.ts`** — shared override store (`category-overrides:shared`); corrections persist across all users
- **`handler.ts`** — formats `list_write` / `list_read` responses grouped by category

### Pantry Staples — `lib/pantry/`

Shared editable staples list (`pantry:shared`). Injected into categorization prompts as household context. Currently separate from `lib/mealplan/pantry.ts` (meal planning exclusions) — intended to be unified in a future pass.

### CalDAV / Calendar — `lib/caldav/`

- All requests go through `calFetch()` which manually follows redirects and re-attaches the `Authorization` header (iCloud strips it on redirect). **Never use raw `fetch()` for CalDAV.**
- `events.ts` — `getUpcomingEvents()`, `createEvent()`, `checkDuplicates()`
- Calendar selection is env-driven: `CALDAV_READ_CALENDARS`, `CALDAV_WRITE_CALENDAR`
- ICS subscription calendars (e.g. Runna) supported via `ICS_SUBSCRIPTIONS` env var
- **iCloud Reminders: not accessible** — Apple's personal Reminders use CloudKit, not CalDAV

### Web Search — `lib/search/`

- **`webSearch.ts`** — single Anthropic API call with `web_search_20260209` tool. Server-side tool: Anthropic handles all search execution internally; model can search multiple times within one call and always returns `end_turn`. Returns `{ responseText, query, sourceUrls, searchCount }`
- **`saveDecision.ts`** — Haiku decides whether result is worth saving to Pinecone (fire-and-forget from route.ts)
- **`store.ts`** — saves search summaries to Pinecone if decision = save

### Sports — `lib/sports/`

- `lookup.ts` — `TEAMS` registry with `teamId` per team, `detectTeam()` (longest-match), ESPN endpoint wrappers for game/score/schedule/standings/stats
- No API key required — ESPN public endpoints only

### Recipes — `lib/recipes/`

- Stored as `Recipe[]` in Redis (`data:recipes`) — full array, full-replace
- `extract.ts` — Haiku extracts structured recipe from URL: title, `## Ingredients` + `## Instructions` markdown, totalTime, servings, cuisine, tags
- UI at `/recipes` — searchable, browsable

### Profile — `lib/profile/`

`UserProfile` fields: `userId`, `homeLocation`, `workLocation`, `commuteCorridor`, `hobbiesAndInterests[]`, `dietaryPreferences[]`, `standingContext`, `updatedAt`. Loaded on every request, injected into all system prompts.

### Session / Context — `lib/session/`

Last 5 turns per user, 4h TTL (`session:{userId}`). Every `generateResponse()` call receives recent turns + Pinecone context notes injected as a `<memory>` block.

### Auth — `lib/auth/`

Bearer token → `"kevin" | "kylie" | null`. Env vars: `KEVIN_SECRET`, `KYLIE_SECRET`. All routes call `authenticateUser(req)` and return 401 on null.

### Skin Log — `lib/skinlog/`

Per-user daily log (`skinlog:{userId}`) — topical products, symptoms, skin condition rating 1–5. UI at `/skinlog`, grouped by date. Primarily used by Kylie.

---

## UI

- Dark theme: `#000` bg, `#111`/`#1a1a1a` cards, `#fff` text, `#888` secondary
- CSS Modules per page/component — no Tailwind
- `"use client"` components store Bearer token in `localStorage`
- Bottom nav: `components/BottomNav.tsx` — current tabs: Chat, Meal Plan, Recipes, Skin Log

---

## Cron

`app/api/cron/route.ts` runs Monday 8am (`vercel.json` schedule: `0 8 * * 1`). Currently a stub — intended to send weekly meal plan + calendar briefing to Kevin and Kylie.

---

## Scripts

| Script | Purpose |
|---|---|
| `scripts/sync-audible.mjs` | Sync Audible library JSON → Pinecone (`kevin-audible`) |
| `scripts/fetch-audible-library.py` | Export Audible library to JSON (requires `audible-quickstart` auth) |
| `scripts/normalize-recipe-units.mjs` | Normalize unit names in all stored recipes (run with `--dry-run` first) |
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
| `CALDAV_USERNAME` | iCloud CalDAV |
| `CALDAV_PASSWORD` | iCloud app-specific password |
| `CALDAV_READ_CALENDARS` | Comma-separated calendar display names to read |
| `CALDAV_WRITE_CALENDAR` | Calendar display name to write events to |
| `ICS_SUBSCRIPTIONS` | `"Name=url,..."` for ICS subscription calendars |
| `DEFAULT_SERVINGS` | Default meal servings (currently hardcoded to `2`) |

---

## Open Items

### Features
- **Weekly briefing cron** — stub exists at `app/api/cron/route.ts`; send meal plan + calendar summary Monday 8am
- **Movies / Books / Audible UI tabs** — data in Pinecone, chat works, no dedicated pages yet
- **`PlannedMeal.mealType`** — extend to support breakfast/lunch variations in meal planning
- **Kylie's Audible** — `audible_library` intent hardcoded to `kevin-audible` namespace
- **Pantry unification** — `lib/pantry/store.ts` (chat-editable staples) and `lib/mealplan/pantry.ts` (grocery exclusions) are separate; should converge to a single source of truth

### Infrastructure
- **iCloud Reminders** — CloudKit-only, not accessible via CalDAV; needs native Apple setup
- **Web search save reliability** — fire-and-forget `decideSave` can be dropped on Vercel function timeout
- **`DEFAULT_SERVINGS` env var** — hardcoded to `2` in `grocery.ts`; should move to `process.env`

### Open questions
- Bottom nav expansion strategy if Movies/Books get dedicated pages (currently 4 tabs)
- Kylie's full onboarding: `KYLIE_SECRET`, profile seed, Audible library sync
