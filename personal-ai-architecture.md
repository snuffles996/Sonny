# Personal AI system — architecture document

**Last updated:** April 2026  
**Repo:** `snuffles996/Sonny`  
**Primary users:** Kevin, Kylie (second account scaffolded, not yet deployed)

---

## Overview

A personal AI assistant built on a serverless backend, vector database, and PWA frontend. Deployed on Vercel. Designed for two users with separate profiles and namespaces, plus shared namespaces for things like recipes and restaurants.

The assistant (named Sonny) handles natural language for calendar management, notes, sports queries, recipe lookup, and general Q&A — all without switching apps.

---

## Stack

| Layer | Tool | Notes |
|---|---|---|
| Backend | Vercel (serverless) | Next.js App Router, all API routes under `/app/api/` |
| AI — reasoning | Claude Sonnet 4.6 | Main response generation |
| AI — fast ops | Claude Haiku 4.5 | Intent classification, event extraction, recipe extraction |
| Vector DB | Pinecone | Single index, per-user namespaces |
| Key-value store | Upstash Redis (Vercel KV) | Session turns + profile + recipe storage |
| Calendar | iCloud CalDAV (direct HTTP) | Read + write; no tsdav — raw PROPFIND/REPORT/PUT |
| Calendar subscriptions | Direct ICS fetch | For external feeds like Runna that don't appear in CalDAV |
| Sports data | ESPN public API | No API key; MLB, NFL, NBA, NHL scoreboard |
| PWA frontend | Next.js + Vercel | Chat UI, recipe browser, bottom nav |
| Recipes | Upstash Redis | Seeded from Obsidian vault; add-from-URL supported |
| Dev / maintenance | Claude Code (desktop) | Architecture and implementation work |

---

## What's live

### Intent routing

Every message goes through Claude Haiku first to classify intent. The classified intent determines the handler:

| Intent | Handler | Notes |
|---|---|---|
| `save_note` | Pinecone upsert | Embeds and stores in user namespace |
| `query` | Semantic search + Claude response | Retrieves relevant notes as context |
| `calendar_read` | CalDAV REPORT | Fetches events across CalDAV + ICS subscriptions |
| `calendar_write` | ESPN lookup → Claude extraction → CalDAV PUT | Enriches with real game times if a team is mentioned |
| `sports_query` | ESPN scoreboard API | Scans up to 7 days forward for next game |
| `profile_update` | Redis write | Updates structured profile document |
| `recipe_add` | URL fetch → JSON-LD → Claude Haiku fallback | Extracts and stores recipe from a URL |

### Context assembly (every API call)

```
System prompt
+ Personal profile (always — injected from Redis)
+ Last 5 conversation turns (Upstash Redis, current session, 4-hour TTL)
+ Relevant notes from Pinecone (semantic search, run speculatively in parallel)
+ Calendar events or sports data (if relevant intent)
+ Current message
```

### Calendar

- **Protocol:** Raw HTTP CalDAV — replaced tsdav because iCloud's homeUrl discovery was broken
- **Auth:** App-specific password from appleid.apple.com stored in Vercel env
- **Redirect handling:** `fetch()` strips Authorization on cross-origin redirects (caldav.icloud.com → p54-caldav.icloud.com). `calFetch()` manually follows redirects and re-attaches auth.
- **Read calendars:** `Kevin's Calendar` + `Runna` (configurable via `CALDAV_READ_CALENDARS`)
- **Write calendar:** `Kevin's Calendar` (configurable via `CALDAV_WRITE_CALENDAR`)
- **ICS subscriptions:** Runna is a subscribed ICS feed, not a native CalDAV collection. Fetched directly via `ICS_SUBSCRIPTIONS` env var and merged with CalDAV results.
- **Timezone:** All dates anchored to `America/Los_Angeles`. Time range queries start at midnight PDT, not UTC now.
- **Event creation:** iCal written with `DTSTART;TZID=`, `DTEND;TZID=`, optional `LOCATION:` and `DESCRIPTION:` fields.

### Sports

- ESPN public scoreboard API — no key required
- Team registry covers ~80 teams across MLB, NFL, NBA, NHL
- `detectTeam(message)` scans for longest matching team name
- `findGame(team, dateStamp)` fetches that sport's scoreboard for a given date
- `findNextGame(message)` loops forward up to 7 days to find the next game
- When creating a calendar event that mentions a team, real ESPN start/end times and venue are injected into the Claude extraction call

### Recipes

- Stored in Upstash Redis as a JSON array keyed by `recipes:all`
- Fields: slug, name, cuisine, source, url, servings, totalTime, addedDate, lastMade, notes (tips), content (markdown ingredients + instructions)
- 68 recipes seeded from Obsidian vault (`scripts/import-vault.mjs`), including addedDate/lastMade/notes from the vault table
- Add from URL: fetch page → parse JSON-LD schema.org/Recipe → Claude Haiku fallback if no structured data
- Recipe browser UI: filter by cuisine + source, full-text AND-word search (quoted phrases for exact match), detail sheet with tips and last-made date

### User profiles

- Flat structured document per user, stored in Redis, injected into every Claude call
- Fields: home location, work location, commute corridor, hobbies/interests, dietary preferences, standing context
- Editable by telling Sonny to update ("remember that I'm vegetarian")

### Auth

- Simple Bearer token per user (`KEVIN_SECRET`, `KYLIE_SECRET` in Vercel env)
- `authenticateUser(req)` returns `"kevin" | "kylie" | null`
- No session cookies — stateless per request, identity carried by token

### Cron

- Vercel Cron fires Monday 8am → `POST /api/cron`
- Job types scaffolded: `pattern-detection`, `cross-user-detection`, `weekly-briefing`
- None are implemented yet — stubs with TODOs

### PWA

- `public/manifest.json` present
- Bottom navigation component (`/components/BottomNav.tsx`)
- Chat page at `/chat`, recipe browser at `/recipes`
- Not yet installable as a proper PWA (no service worker, no offline support)

---

## File map

```
app/
  api/
    chat/route.ts         — main POST handler; all intent routing
    calendar/route.ts     — direct calendar read endpoint
    cron/route.ts         — scheduled job stubs
    notes/route.ts        — notes API
    profile/route.ts      — profile read/write
    recipes/route.ts      — recipe listing
  chat/page.tsx           — chat UI
  recipes/page.tsx        — recipe browser
  layout.tsx / globals.css / page.tsx

components/
  BottomNav.tsx           — tab bar

lib/
  anthropic/
    client.ts             — singleton + model constants (Sonnet 4.6 / Haiku 4.5)
    classify.ts           — intent classification via forced tool_use
    calendar.ts           — event detail extraction (accepts optional GameInfo)
    profile.ts            — profile update extraction
    respond.ts            — response generation + system prompt builder
  auth/index.ts           — Bearer token auth
  caldav/
    client.ts             — raw HTTP CalDAV: PROPFIND, REPORT, PUT, redirect handling
    events.ts             — iCal parsing, getUpcomingEvents, createEvent, ICS subscriptions
  pinecone/
    client.ts             — singleton
    records.ts            — saveNote, searchNotes
  profile/
    store.ts              — Redis get/set
    types.ts              — UserProfile, UserId
  recipes/
    extract.ts            — URL fetch → JSON-LD → Claude Haiku extraction
    store.ts              — Redis get/upsert
    types.ts              — Recipe interface
  redis/client.ts         — Upstash Redis singleton
  session/kv.ts           — session turns (last 5, 4-hour TTL)
  sports/lookup.ts        — ESPN API, team registry, detectTeam, findGame

scripts/
  import-vault.mjs        — one-time seed: Obsidian recipes + vault table metadata → Redis

vercel.json               — cron schedule (Monday 8am)
```

---

## Environment variables

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API |
| `PINECONE_API_KEY` | Pinecone |
| `PINECONE_INDEX_NAME` | Pinecone index (default: `sonny`) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash Redis (Vercel Marketplace, auto-injected) |
| `CALDAV_USERNAME` | iCloud Apple ID |
| `CALDAV_PASSWORD` | iCloud app-specific password |
| `CALDAV_READ_CALENDARS` | Comma-separated calendar names to read (default: `Kevin's Calendar,Runna`) |
| `CALDAV_WRITE_CALENDAR` | Calendar to write new events to (default: `Kevin's Calendar`) |
| `ICS_SUBSCRIPTIONS` | `Name=URL` pairs for direct ICS feeds (e.g. Runna) |
| `KEVIN_SECRET` | Bearer token for Kevin |
| `KYLIE_SECRET` | Bearer token for Kylie |
| `CRON_SECRET` | Vercel Cron auth secret |

---

## Pinecone namespace plan

| Namespace | Owner | Status |
|---|---|---|
| `kevin-notes` | Kevin | Active |
| `kylie-notes` | Kylie | Not yet populated |
| `shared-recipes` | Both | Not yet — recipes currently in Redis only |
| `shared-restaurants` | Both | Not started |
| `shared-movies` | Both | Not started |
| `shared-travel` | Both | Not started |

Notes: Conversation history was originally planned for Pinecone but is currently in Redis only (last 5 turns). Long-term semantic search of past conversations is not yet implemented.

---

## Outstanding to-do list

### Short-term / high value

- **Kylie's account** — set `KYLIE_SECRET`, populate `kylie-notes` in Pinecone, verify profile flow works end-to-end
- **Action Button + Scriptable** — reconfigure iPhone Action Button to deep-link into the PWA chat with a pre-filled voice/text input
- **Location lookup for events** — when adding a calendar event with a venue name (e.g. "at Novo"), do a quick lookup or at minimum store the name in `LOCATION:` (field already supported in iCal)
- **Push notifications** — PWA push for iOS 16.4+; useful for weekly briefing delivery
- **Session continuity** — currently stateless per-request; consider longer-lived session or `conversation_id` for multi-device

### Medium-term

- **Weekly briefing** — implement the `weekly-briefing` cron job: pull upcoming calendar events, surface any recently saved notes, generate a short Monday summary
- **Pattern detection** — scan Pinecone for clusters / recurring topics, surface suggestions in chat ("you've mentioned your knee pain 4 times this month")
- **Obsidian write-back** — async mirror: when a note is saved to Pinecone, also write a `.md` file to iCloud Drive for browsing in Obsidian
- **Conversation history in Pinecone** — store past turns in `kevin-conversations` namespace; semantic search over long-term history
- **Shared namespaces** — move recipes to Pinecone `shared-recipes`; add restaurants, movies, travel; both users can read/write

### Longer-term

- **Meal planning** — weekly meal picker, grocery list generation from selected recipes
- **Cross-user pattern detection** — compare Kevin and Kylie notes for shared namespace candidates
- **`added_by` attribution** — tag shared namespace records with who added them
- **TestFlight iOS app** — wrap PWA in Capacitor for native notifications, Siri shortcuts, widgets
- **Purge policy** — define retention for conversation history (e.g. keep last 90 days in Pinecone)
- **Richer recipe import** — handle sites that block fetch; add manual entry flow
- **Gym / fitness awareness** — surface Runna workouts when planning the day; integrate effort level into scheduling suggestions

---

## Known constraints / decisions made

- **No tsdav** — iCloud CalDAV discovery is broken in tsdav; replaced with raw HTTP
- **App-specific password required** — regular Apple ID password is rejected by iCloud CalDAV
- **Subscribed ICS calendars (Runna) don't appear in CalDAV PROPFIND** — fetched directly via `ICS_SUBSCRIPTIONS`
- **Timezone anchor is America/Los_Angeles** — hardcoded for now; would need to come from profile if users diverge
- **Recipes in Redis, not Pinecone** — Redis is simpler for structured list browsing; Pinecone semantic search could be added later for ingredient-based queries
- **Auth is a shared secret per user** — adequate for personal use; not suitable if the surface area grows
- **Wife is Kylie** — original design doc said "Sarah" but user's wife is Kylie; types and code use `"kylie"`
