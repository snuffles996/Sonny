# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # start local dev server (localhost:3000)
npm run build    # production build — run this to catch TypeScript errors
npm run lint     # ESLint via next lint
```

No test suite exists yet. Use `npm run build` as the primary correctness check — the project uses TypeScript strict mode.

## Architecture

**Stack:** Next.js 14 App Router · TypeScript · Vercel · Anthropic SDK (direct, not AI SDK) · Pinecone · Upstash Redis · iCloud CalDAV

### Request flow

All user interactions enter through `POST /api/chat`. The handler:
1. Authenticates via Bearer token → resolves to `"kevin"` or `"kylie"`
2. Runs profile load, session turns, intent classification, and Pinecone context search **in parallel**
3. Routes to a handler based on the classified intent
4. Persists both turns to Redis **sequentially** (order matters)
5. Returns `{ reply, intent, saved }`

### Dual-model pattern

- **Sonnet** (`MODEL` in `lib/anthropic/client.ts`) — response generation in `lib/anthropic/respond.ts`
- **Haiku** (`FAST_MODEL`) — all extraction and classification tasks: `classify.ts`, `calendar.ts`, `profile.ts`, `recipes/extract.ts`

All Haiku calls use **forced tool_use** (tool with `required` input schema + `tool_choice: { type: "tool" }`). Follow this same pattern when adding new extraction functions.

### Intent system

`lib/anthropic/classify.ts` defines the `Intent` union type and calls Haiku to classify. `app/api/chat/route.ts` switches on the result. When adding a new capability:
1. Add the new intent string to the `Intent` type in `classify.ts`
2. Add a description to the system prompt array and the enum in the tool schema
3. Add a `case` handler in the chat route switch statement
4. Update the capabilities list in `lib/anthropic/respond.ts` `buildSystemPrompt()`

### CalDAV (iCloud)

**Do not use the `tsdav` package** — it's installed but not used. iCloud's CalDAV redirects strip the `Authorization` header, so all requests go through `calFetch()` in `lib/caldav/client.ts`, which manually follows redirects and re-attaches auth. **Any new CalDAV or Reminders code must use `calFetch()`**, not raw `fetch()`.

- Reads: `lib/caldav/events.ts` — `getUpcomingEvents()`, `fetchCalendarIcals()`
- Writes: `lib/caldav/events.ts` — `createEvent()` via `putCalendarObject()` in client
- Calendar selection is env-driven: `CALDAV_READ_CALENDARS`, `CALDAV_WRITE_CALENDAR`
- iCloud Reminders use the same protocol at `reminders.icloud.com` with VTODO instead of VEVENT

### Data storage patterns

| Data | Key pattern | File |
|---|---|---|
| User profile | `profile:{userId}` | `lib/profile/store.ts` |
| Session turns | `session:{userId}` | `lib/session/kv.ts` |
| Recipes | `data:recipes` (full array) | `lib/recipes/store.ts` |
| Active meal plan | `mealplan:shared:active` | `lib/mealplan/store.ts` |
| Meal plan prefs | `mealplan:shared:prefs` | `lib/mealplan/store.ts` |

All Redis access goes through the `getRedisClient()` singleton in `lib/redis/client.ts` (Upstash, env vars: `KV_REST_API_URL`, `KV_REST_API_TOKEN`).

Recipe and profile stores use a **full-replace pattern**: fetch the current value, merge/update, write back. There are no atomic partial updates.

### Auth

`lib/auth/index.ts` — reads `Authorization: Bearer <token>`, matches against `KEVIN_SECRET` or `KYLIE_SECRET`, returns `"kevin" | "kylie" | null`. All API routes call `authenticateUser(req)` and 401 if null.

### Pinecone (notes/memory)

`lib/pinecone/records.ts` — `saveNote(userId, text)` and `searchNotes(userId, query)`. Namespaces are per-user for private notes (`kevin-notes`, `kylie-notes`) and shared for categories (`shared-restaurants`, `shared-movies`, etc.). The namespace registry is in `lib/pinecone/client.ts`.

### Sports (ESPN)

`lib/sports/lookup.ts` — all ESPN API calls. ESPN's public API requires no key. `detectTeam(message)` uses longest-match against the `TEAMS` registry. `findGame()` uses the scoreboard endpoint; schedule/standings/stats use team-specific endpoints that require `teamId` in the registry entry.

### UI conventions

- Dark theme: `#000` background, `#111`/`#1a1a1a` cards, `#fff` text, `#888` secondary
- CSS Modules per page/component, no Tailwind (despite SETUP.md — it was not used)
- Client components use `"use client"` + Bearer token stored in `localStorage`
- `components/BottomNav.tsx` drives tab navigation — add new tabs to the `TABS` array

### Deployment

Push to `main` → Vercel auto-deploys. Cron job at `app/api/cron/route.ts` runs Monday 8am (configured in `vercel.json`). Environment variables are managed in the Vercel dashboard.
