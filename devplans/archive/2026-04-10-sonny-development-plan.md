# Sonny — Development Plan
**Prepared for Claude Code handoff | April 2026**
**Repo:** `snuffles996/Sonny`

---

## How to use this document

Read `personal-ai-architecture.md` in full before touching any code — it is the source of truth for the stack, file layout, environment variables, and decisions already made. This document describes what to build next and why. Implement one area at a time in the order listed.

---

## Area 1: Sports Overhaul

### Problem

The current sports handler (`lib/sports/lookup.ts`) is too narrow. It handles one pattern — "when is the next [team] game?" — and returns only the start time. The ESPN API returns much richer data (scores, records, schedules, standings, player stats) and none of it is exposed. The intent classifier doesn't route any other sports questions to meaningful handlers.

### Goals

- Answer live/recent scores, upcoming multi-game schedules, season standings, and basic player stats
- Bulk-create calendar events for a full team schedule in one request
- Keep all ESPN calls free / no API key (same pattern as today)

---

### 1.1 ESPN API endpoints to add

All public, no auth required. The sport slug is one of: `baseball/mlb`, `football/nfl`, `basketball/nba`, `hockey/nhl`.

| Data | Endpoint |
|---|---|
| Scoreboard (existing) | `site.api.espn.com/apis/site/v2/sports/{sport}/scoreboard?dates={YYYYMMDD}` |
| Team schedule | `site.api.espn.com/apis/site/v2/sports/{sport}/teams/{teamId}/schedule` |
| Standings | `site.api.espn.com/apis/site/v2/sports/{sport}/standings` |
| Athlete search | `site.api.espn.com/apis/site/v2/sports/{sport}/athletes?limit=10&search={name}` |
| Athlete stats | `site.api.espn.com/apis/site/v2/sports/{sport}/athletes/{athleteId}/statistics` |

**Team ID requirement:** The team schedule and stats endpoints require ESPN's internal `teamId`, not just the team name. Add a `teamId` field to every entry in the existing team registry in `lib/sports/lookup.ts`. Find IDs by fetching `site.api.espn.com/apis/site/v2/sports/{sport}/teams` — each entry has `id`, `name`, and `abbreviation`.

---

### 1.2 New intent types

Extend the intent enum in `lib/anthropic/classify.ts` with:

| Intent | Example trigger phrases |
|---|---|
| `sports_score` | "what was the score last night", "did the Padres win" |
| `sports_schedule` | "when are the next 5 Chargers games", "show me the Lakers schedule" |
| `sports_standings` | "what place are the Giants in", "NL West standings" |
| `sports_player_stats` | "how is Shohei Ohtani doing this season", "Tatum's stats" |
| `sports_calendar_bulk` | "add all Padres home games to my calendar", "put the whole Chiefs schedule on my calendar" |

The existing `sports_query` intent stays for the "next game" case — don't break what works.

---

### 1.3 Handler implementations

Add these functions to `lib/sports/lookup.ts`:

**`getScore(team, daysBack = 1)`**
Scan the scoreboard for the past N days looking for a completed game involving the team. Return: home team, away team, final score, game status, date. If the game is live, return the current score and inning/quarter/period.

**`getSchedule(team, numGames = 5)`**
Fetch `teams/{teamId}/schedule`. Filter to upcoming games only (status not `post`). Return the next N games with date, time (America/Los_Angeles), opponent, home/away, and venue.

**`getStandings(sport, division?)`**
Fetch standings for the sport. If the user named a division ("NL West", "AFC East"), filter to that division. Return each team's wins, losses, winning percentage, and games behind the leader. Sort by winning percentage descending.

**`getPlayerStats(playerName, sport)`**
Search for the athlete by name. Pick the closest match. Fetch their statistics for the current season. Return the most relevant stats for the sport (batting average/ERA for MLB, PPG/RPG/APG for NBA, etc.).

**`getBulkSchedule(team)`**
Fetch the full season schedule for a team. Return all games regardless of status: date, time (LA timezone), opponent, home/away, venue. This is the data source for bulk calendar creation.

---

### 1.4 Bulk calendar event creation

When intent is `sports_calendar_bulk`:

1. Call `getBulkSchedule(team)` to get all games
2. Prompt the user to confirm scope if the result is large: "I found 81 Padres games. Do you want all of them, just home games, or a specific date range?"
3. Run `checkDuplicates()` (see Area 3) against the confirmed set to skip already-existing events
4. For each remaining game, call the existing `createEvent()` CalDAV function with:
   - Title: e.g. `Padres vs Dodgers` or `Padres @ Dodgers` for away games
   - Start/end: from ESPN data, anchored to `America/Los_Angeles`
   - Location: venue name from ESPN
   - Description: home/away indicator, opponent record if available
5. Batch PUT requests with a concurrency limit of 5 to avoid hammering CalDAV
6. Report results: "Added 69 Padres games to your calendar. Skipped 12 already there."

---

### 1.5 Response generation

Update `lib/anthropic/respond.ts` so the system prompt instructs Sonny to present sports data naturally:
- Scores: conversational ("The Padres beat the Dodgers 4–2 last night")
- Schedules: a clean list, not a data dump
- Standings: a compact markdown table is fine
- Player stats: highlight the 3–4 most meaningful numbers for the sport

---

## Area 2: Meal Planning + Grocery Lists

### Overview

Meal planning is initiated from chat ("plan 4 meals this week") or from a quick-start button on a new Meal Plan tab. Sonny suggests a list of N recipes — not assigned to specific days — the user approves or swaps individual meals, then generates a combined grocery list displayed in-app and pushed to iCloud Reminders. The plan is **shared between Kevin and Kylie** — both can read and write it, last write wins. The plan persists in Redis. Meals are checked off as made from the Meal Plan tab, which updates `lastMade` and prompts for notes.

---

### 2.1 Data model

All stored in Upstash Redis.

**Active meal plan** — key: `mealplan:shared:active`
Shared between users. Each meal tracks `addedBy` so you can see who picked what, but either user can remove or swap any meal.

```typescript
interface MealPlan {
  createdAt: string        // ISO timestamp
  updatedAt: string        // ISO timestamp — updated on every write
  updatedBy: UserId        // "kevin" | "kylie"
  meals: PlannedMeal[]
  servings: number         // default servings for this plan
  groceryListSent: boolean
}

interface PlannedMeal {
  recipeSlug: string
  recipeName: string
  addedBy: UserId          // who added this meal to the plan
  servings?: number        // per-meal override of plan-level servings
  made: boolean
  madeBy?: UserId          // who checked it off
  madeAt?: string          // ISO timestamp set when checked off
  notes?: string           // logged when checked off
}
```

**Plan history** — key: `mealplan:shared:history` — array of completed `MealPlan` objects. Append when a plan is cleared or replaced.

**Shared preferences** — key: `mealplan:shared:prefs`

```typescript
interface MealPlanPrefs {
  defaultRemindersListName: string   // e.g. "Grocery List" — changeable by telling Sonny
}
```

This replaces the `REMINDERS_LIST_NAME` environment variable. Sonny uses the saved default every time. Either user can change it by saying "use the list called Groceries instead."

---

### 2.2 Recipe selection logic

When Sonny receives a meal planning intent, select recipes using these rules in order:

1. **Exclude recently made dishes** — filter out any recipe where `lastMade` is within the past 14 days
2. **Exclude current plan** — if there's already an active plan, don't repeat those recipes
3. **Calendar awareness** — fetch upcoming events for the next 7 days via the existing CalDAV reader. For any day with 2+ events or an event ending after 7pm, flag it as a "busy night." When presenting suggestions in chat, note which meals are quick (under 30 min `totalTime`) and suggest those for busy nights
4. **Dietary preferences** — filter against `dietaryPreferences` from the user's Redis profile. This is a hard filter
5. **Variety** — across the N selected meals, prefer a mix of cuisines. Don't pick 4 Italian dishes if alternatives exist

After filtering, pass the candidate list to Claude Sonnet to choose the final N recipes. Surface brief reasoning to the user ("picked this one because you haven't made it recently and your week looks light on Thursday").

---

### 2.3 New intent types

Add to `lib/anthropic/classify.ts`:

| Intent | Example trigger phrases |
|---|---|
| `meal_plan_create` | "plan 4 meals", "what should we cook this week", "suggest some dinners" |
| `meal_plan_swap` | "swap the pasta for something else", "replace that one" |
| `meal_plan_grocery` | "make me a grocery list", "what do I need to buy" |
| `meal_plan_clear` | "clear the meal plan", "start over" |

---

### 2.4 Conversational flow in chat

**Creation flow:**

User: "plan 4 meals for this week"

Sonny:
- Runs selection logic (calendar check + filters)
- Responds with a numbered list of 4 recipes, each with name, cuisine, and total time
- Offers to swap: "Let me know if you'd like to swap any of these out"
- If servings weren't mentioned, asks: "How many servings per meal?" before finalizing
- Saves the plan to Redis as the active plan

**Swap flow:**

User: "swap #3 for something different" or "I don't want pasta"

Sonny:
- Identifies the meal to replace
- Picks an alternative from the filtered candidate pool (not already in the plan)
- Confirms the swap and updates Redis

**Grocery list flow:**

User: "make a grocery list" or "what do I need to buy"

Sonny:
- Reads the active plan from Redis
- Scales and combines ingredients (see 2.5)
- Displays the grouped list in chat
- Pushes to iCloud Reminders (see 2.6)
- Sets `groceryListSent: true` on the active plan

---

### 2.5 Ingredient scaling, unit unification, and combination

New file: `lib/recipes/grocery.ts`

**Scaling:** Each recipe has a `servings` field. Scale all ingredient quantities proportionally: `scaledQty = (ingredient.qty / recipe.servings) * requestedServings`. Apply scaling before any combining step.

**Unit unification — two-tier system:**

The app stores recipes with whatever units they were imported in (metric or imperial). Before combining, attempt to unify units within the same ingredient across recipes. Use imperial as the display standard for the grocery list (most US recipes use it).

*Tier 1 — Known convertible units:* Maintain a conversion table for standard units. Normalize before combining:
- Volume: ml → tsp/tbsp/cups (1 tsp = 5ml, 1 tbsp = 15ml, 1 cup = 240ml)
- Weight: g → oz (1 oz = 28.35g), kg → lbs
- Common aliases: "tbsp" = "tablespoon", "tsp" = "teaspoon", "c" = "cup"

After normalizing, combine quantities that now share the same unit: `500ml olive oil` + `2 tbsp olive oil` becomes `2 cups + 2 tbsp olive oil` (convert 500ml → ~2 cups first, then add).

*Tier 2 — Folk / unresolvable units:* Some units have no reliable conversion: "thumb of ginger," "knob of butter," "handful of herbs," "to taste," "a pinch." These cannot be combined with standard quantities. When an ingredient has both a resolvable and an unresolvable quantity across recipes, display both joined with `+`:

```
Ginger — 1 oz + 1 thumb
Butter — 3 tbsp + 1 knob
```

If all quantities for an ingredient are unresolvable folk units, combine them as counts if they're the same unit (`2 thumbs ginger`) or list separately if different.

**Folk unit dictionary:** Maintain a lookup of known folk units so they're recognized and not mistakenly treated as errors: thumb, knob, handful, bunch, sprig, pinch, dash, splash, to taste, as needed.

**Recipe attribution:** Each combined ingredient tracks which recipes contributed to it. This is used in the in-app shopping list UI (see 2.8) but not sent to Reminders.

```typescript
interface GroceryItem {
  name: string                    // e.g. "Garlic"
  displayQty: string              // e.g. "5 cloves" or "1 oz + 1 thumb"
  category: FoodCategory
  sourceRecipes: string[]         // recipe names that use this ingredient
  hasMultipleSources: boolean     // true if sourceRecipes.length > 1
}
```

**Categorization:** Map each ingredient to a food group using a lookup table for common ingredients. For unrecognized ingredients, use Claude Haiku to classify them — batch all unknowns in a single API call.

Food group categories: **Produce**, **Proteins**, **Dairy & Eggs**, **Pantry & Dry Goods**, **Canned & Jarred**, **Frozen**, **Beverages**, **Other**.

---

### 2.6 iCloud Reminders integration

iCloud Reminders are accessible via CalDAV using the same credentials already in use for the calendar. The endpoint is `reminders.icloud.com` instead of `caldav.icloud.com`. The protocol is identical but uses `VTODO` components instead of `VEVENT`.

The Reminders list is **shared** — you'll set this up as a shared iCloud Reminders list offline. Sonny just writes to the list name stored in `mealplan:shared:prefs.defaultRemindersListName`. Either user can change the default by telling Sonny: "use the list called Groceries instead" — this triggers a `meal_plan_prefs_update` intent that writes the new name to Redis.

**New file: `lib/caldav/reminders.ts`**

**`getOrCreateList(listName: string)`** — PROPFIND to find a list by name. If it doesn't exist, create it with MKCOL. Return the list href.

**`getExistingItems(listHref: string)`** — REPORT to fetch all current VTODOs in the list. Returns count and item titles.

**`clearList(listHref: string)`** — DELETE each existing VTODO in the list.

**`addReminder(listHref: string, title: string)`** — PUT a new VTODO with a generated UID, `SUMMARY:{title}`, and `STATUS:NEEDS-ACTION`.

**`pushGroceryList(items: GroceryItem[], userId: string)`** — orchestrates the full flow:

1. Read `mealplan:shared:prefs.defaultRemindersListName` from Redis
2. Call `getOrCreateList(listName)`
3. Call `getExistingItems()` to check if the list already has items
4. **If existing items are found:** respond in chat before pushing — "Your Grocery List already has 14 items. Replace them or add to them?" Wait for confirmation before proceeding. Handle `clear` and `append` responses
5. Push all items grouped by category. Format each as: `Ingredient — quantity` (e.g. `Garlic — 5 cloves`, `Ginger — 1 oz + 1 thumb`)
6. Report back: "Added 32 items to your Grocery List in Reminders."

**Critical:** Use the same `calFetch()` redirect-handling wrapper from `lib/caldav/client.ts`. The cross-origin redirect issue that affects CalDAV will affect Reminders too — do not use raw `fetch()`.

---

### 2.7 New API route

**`app/api/mealplan/route.ts`**

| Method | Body / Action |
|---|---|
| `GET` | Return active meal plan for the authenticated user |
| `POST` | Create or replace the active plan — body: `{ meals: PlannedMeal[], servings: number }` |
| `PATCH` | Update a single meal — body: `{ slug, made?, notes?, replacementSlug? }` |
| `DELETE` | Clear the active plan (archive to history first) |

Auth uses the existing `authenticateUser()` pattern.

---

### 2.8 Meal Plan tab UI

**New files:**
- `app/mealplan/page.tsx`
- `components/MealPlanCard.tsx`
- `components/CheckOffModal.tsx`
- `components/GroceryList.tsx`

**Tab structure within the Meal Plan page:**

The Meal Plan page itself has two sub-tabs at the top:
- **Meals** — the list of planned recipe cards with checkboxes
- **Shopping List** — the combined, unified grocery list

This keeps meal cards and the ingredient list in one place without jumping between pages.

---

**Meals sub-tab:**

*Empty state (no active plan):*
- Message: "No meals planned yet"
- Primary button: "Plan meals" — opens a quick-start bottom sheet

*Quick-start bottom sheet:*
- Stepper: "How many meals?" (default 4, range 1–7)
- Optional free-text field: "Any preferences?" (e.g. "nothing spicy", "something quick")
- "Suggest meals" button — posts to `/api/chat` with the constructed prompt, then navigates to the Chat tab to show Sonny's response

*Active plan state:*
- Header: "X meals planned" + "Clear plan" button (confirmation required)
- Small `addedBy` label on each card ("Kevin" / "Kylie") so you know who picked it
- List of `MealPlanCard` components

Each `MealPlanCard` shows:
- Recipe name (tappable — navigates to recipe detail, same as Recipes tab)
- Cuisine badge + total time
- `addedBy` label
- Checkbox — tapping opens `CheckOffModal`

*CheckOffModal:*
- "Mark [Recipe Name] as made?"
- Optional notes textarea: "Any notes or tweaks?" (pre-populated with existing recipe `notes` if present)
- Confirm — calls `PATCH /api/mealplan` with `{ slug, made: true, notes }`, then `PATCH /api/recipes/{slug}` to update `lastMade`
- Cancel

---

**Shopping List sub-tab:**

Shown only after a grocery list has been generated for the current plan. Before generation, show a prompt: "Ready to build your grocery list? Tap below or ask Sonny in chat." with a "Build grocery list" button.

*List display:*

Grouped by food category with a section header for each. Within each section, ingredients are sorted alphabetically.

Each ingredient row shows:
- Ingredient name and unified quantity (e.g. `Garlic — 5 cloves` or `Ginger — 1 oz + 1 thumb`)
- If `hasMultipleSources` is true: a small tappable tag showing the number of recipes (e.g. `2 recipes`). Tapping it expands an inline list of the recipe names that use this ingredient
- If `hasMultipleSources` is false: a single smaller recipe name shown inline as secondary text

*Example rendering:*

```
Produce
  Garlic — 5 cloves          [Pasta Bolognese, Chicken Stir-fry]
  Ginger — 1 oz + 1 thumb    Chicken Stir-fry
  Lemon — 2                  Lemon Herb Salmon

Proteins
  Chicken thighs — 1.5 lbs   Chicken Stir-fry
  ...
```

*Push to Reminders button:*
- Fixed at the bottom of the Shopping List sub-tab
- Label: "Send to Reminders"
- Calls the push flow (see 2.6) — handles the existing items check inline in chat or via an in-app confirmation sheet

---

**Bottom nav update:**
Add "Meals" to `components/BottomNav.tsx`. Use whatever icon set is already in the project. Note: additional tabs (Movies, Books, etc.) will be designed in a future session — leave room in the nav for expansion without hardcoding a fixed layout.

---

## Area 3: Calendar Flexibility

### Problem

Calendar reads and writes work but are rigid — no date-range querying and no bulk operations. Area 1 depends on the deduplication utility built here.

---

### 3.1 Date-range parsing

Extend `getUpcomingEvents()` in `lib/caldav/events.ts` to accept a `{ from: Date, to: Date }` range instead of a fixed number of days forward.

Update the intent classifier and calendar handler to map natural language to ranges. All anchored to `America/Los_Angeles` midnight:

| Phrase | Range |
|---|---|
| "this week" | Monday–Sunday of current week |
| "next week" | Following Monday–Sunday |
| "this weekend" | Saturday–Sunday of current week |
| "next 3 days" | Today + 2 days |
| "rest of the month" | Today through last day of current month |
| "next month" | 1st through last day of next month |

---

### 3.2 Deduplication utility

Required by the bulk sports calendar create in Area 1.

Add to `lib/caldav/events.ts`:

**`checkDuplicates(drafts: EventDraft[], from: Date, to: Date): Promise<{ toCreate: EventDraft[], toSkip: EventDraft[] }>`**

Fetch existing CalDAV events in the date range. For each draft event, check if an event with the same title and date already exists. Return two lists: events to create and events to skip. The bulk create handler uses this to report: "Skipped 12 events already on your calendar, added 69 new ones."

---

### 3.3 Event creation feedback

After a successful CalDAV PUT, return the created event's title, date, and time in the confirmation message rather than a generic "done." If creation fails, surface the actual CalDAV error reason rather than swallowing it.

---

## Implementation order

Work through this sequence — each step unblocks the next:

1. **Sports — team registry update** (add `teamId` to all entries in `lib/sports/lookup.ts`)
2. **Sports — new ESPN fetch functions** (`getScore`, `getSchedule`, `getStandings`, `getPlayerStats`, `getBulkSchedule`)
3. **Sports — new intent types + routing** in `classify.ts` and `app/api/chat/route.ts`
4. **Calendar — deduplication utility** (needed before bulk sports create)
5. **Calendar — date-range parsing**
6. **Sports — bulk calendar create** (depends on steps 2, 4, 5)
7. **Meal plan — data model + Redis store** (`lib/recipes/mealplan.ts`)
8. **Meal plan — selection logic** (filtering, calendar awareness, variety)
9. **Meal plan — new intent types + routing**
10. **Meal plan — chat flow** (creation, swap, grocery list)
11. **Meal plan — grocery list logic** (`lib/recipes/grocery.ts`)
12. **Meal plan — iCloud Reminders** (`lib/caldav/reminders.ts`)
13. **Meal plan — API route** (`app/api/mealplan/route.ts`)
14. **Meal plan — UI** (tab, MealPlanCard, CheckOffModal, BottomNav)

---

## New environment variables

| Variable | Purpose | Default |
|---|---|---|
| `DEFAULT_SERVINGS` | Default servings if not specified during meal planning | `2` |

No new API keys required. The Reminders list name is stored in Redis (`mealplan:shared:prefs`) rather than as an env var — it's user-configurable via chat. Reminders use the existing `CALDAV_USERNAME` / `CALDAV_PASSWORD` pointed at `reminders.icloud.com`.

---

## Things not to break

- The existing `findNextGame` / `sports_query` flow — add new handlers alongside it, don't refactor the working path
- The `calFetch()` redirect wrapper — all new CalDAV and Reminders code must use it
- The Recipes tab and Redis recipe store — meal planning reads from it; the only write-back is `lastMade` via existing store functions
- Session turn history in Redis — meal plan state is separate from conversation turns
- Per-user namespaces for notes — meal plan is shared (`mealplan:shared:*`) but notes stay per-user (`kevin-notes`, `kylie-notes`)

---

## Open questions to revisit later

- **Breakfast/lunch support** — `PlannedMeal` has no `mealType` field yet. When added, lunch could be free-text notes rather than recipe slugs, and breakfast a simple "did we prep?" toggle. Leave the model extensible.
- **Kylie's meal plan access** — the data model is already shared (`mealplan:shared:active`). Will work once Kylie's account is set up and she has her bearer token.
- **Shared Reminders list setup** — needs to be configured in iCloud offline (share the list with Kylie). Sonny just writes to the stored list name; it doesn't manage sharing.
- **Unit import cleanup** — the existing 68 imported recipes may have inconsistent units from import. Consider a one-time migration script that runs the unit normalization pass over all stored recipes and standardizes what it can. Doesn't need to block the grocery list feature — the grocery logic handles mixed units gracefully — but cleaner source data means fewer `+` fallbacks.
- **Folk unit dictionary expansion** — will grow as edge cases are found. Consider storing it in Redis so it's editable without a redeploy.
- **Weekly briefing cron** — the Monday 8am cron stub in `cron/route.ts` should eventually pull the active shared meal plan and upcoming calendar events into a Monday summary. The shared plan API route makes this straightforward to add later.
- **Future tabs (Movies, Books, etc.)** — navigation expansion will be designed in a dedicated session. Don't hardcode the bottom nav to a fixed number of items; make it easy to extend.
