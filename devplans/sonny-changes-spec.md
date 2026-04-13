# Sonny — Planned Changes Spec

*This document summarizes feature changes and UI decisions discussed for the Sonny personal assistant app. It is intended as a briefing document to share with Claude or collaborators before implementation begins.*

---

## 1. Navigation Redesign

### Current state
Bottom navigation has four items: Chat, Recipes, Meals, Skin Log.

### Changes

**Bottom bar — reduce to three items:**

| Position | Label | Icon |
|---|---|---|
| Left | Menu | 2×2 grid (four small squares) |
| Center | Chat | Speech bubble |
| Right | Meals | Fork and knife |

**Skin Log:** Remove from bottom navigation. Keep all infrastructure and data intact — just remove the nav link. The page remains accessible if needed later.

**Menu — slide-up overlay (bottom sheet):**

Tapping Menu opens an overlay that slides up over the current screen. It does not navigate to a new page. Tapping any item navigates to that section; the back button returns to the previous screen. The Menu nav item shows as active while the overlay is open.

Overlay contents, in order:

1. **Settings row** (top, above a divider) — shows the user's name (Kevin or Kylie) and "Settings & preferences" as a subtitle. Chevron on the right. This is the entry point for profile, color scheme, text size, and future per-user configuration. Profile is expected to be rarely edited, so it lives here rather than in the main nav.

2. **Library section** (below divider, labeled "Library"):
   - Books
   - Movies & TV
   - Recipes

*UI reference: the nav mockup widget shows both the closed and open states of the bottom bar and menu overlay, including the slide-up animation.*

---

## 2. Settings / Profile Page

A dedicated settings destination accessible from the top of the Menu overlay. For now it serves as the home for Kevin and Kylie's profile data (home location, work location, dietary preferences, standing context, etc.). In the future it will also host:

- Color scheme preference
- Text size
- Notification preferences
- Per-user library connections (e.g. linking Audible account)
- Multi-user onboarding if Sonny expands beyond Kevin and Kylie

No detailed UI has been designed yet — keep it simple for the initial implementation.

---

## 3. Books Library

### Overview
Replace the current flat Pinecone-only approach for books with a structured Redis store (similar to the recipes pattern), with Pinecone used on top for semantic search only.

### Data model — `Book`

```ts
type Book = {
  id: string
  title: string
  author: string
  series?: string
  seriesPosition?: number          // e.g. 1, 2, 3
  audibleAsin?: string             // links record to Audible for sync
  status: "shelf" | "want_to_read" | "reading" | "finished"
  source?: "audible" | "physical" | "kindle" | "other"
  recommendedBy?: string           // free text — person's name or "Sonny"
  rating?: number                  // 1–5
  notes?: string
  tags?: string[]
  coverUrl?: string                // from Google Books or Open Library API
  dateAdded?: string
  dateStarted?: string
  dateFinished?: string
  lastSyncedAt?: string            // timestamp of last Audible sync for this record
}
```

### Redis key
`library:{userId}:books` — `Book[]` full array, full-replace pattern (consistent with existing stores).

### Audible sync update
The existing `sync-audible.mjs` script currently dumps flat text into Pinecone. Update it to upsert into the structured Redis store instead:
- Match by `audibleAsin`
- If record exists: update listening progress / finished status, update `lastSyncedAt`
- If record does not exist: create new entry with `status: "shelf"` and `source: "audible"`
- User-set fields (rating, notes, recommendedBy, tags) are never overwritten by sync

### What Audible provides
- Title, author, narrator, cover image, ASIN
- Purchase/download date
- Runtime
- Series name and position (reliable)
- Listening progress % — use to infer `status: "finished"` if at 100%
- Finish date: not reliably available — progress % is the proxy

### New chat intents needed
- `book_add` — save a book to the library with optional "recommended by" field
- `book_update` — mark as reading/finished, add rating or notes
- Update `book_search` and `audible_library` intents to read from structured Redis store; embed title + author + notes + tags into Pinecone for semantic search

### Books library page — `/books`

**List view:**
- Search bar at top: "Search titles, authors…"
- Filter chips: All / Reading / Want to read / Finished / On shelf
- Each row contains:
  - Thumbnail cover image (left) — sourced from Google Books or Open Library API; placeholder shown until available
  - Title and author (bold title, muted author below)
  - Series name and position (e.g. "Children of Time · #1") — italic, smaller
  - Status badge (right) — color coded: Finished (green), Reading (amber), Want to read (blue/purple), On shelf (grey)
  - Star rating (right, below badge) — shown as filled/unfilled stars; empty if unrated

**Detail view (slide in from right on row tap):**
- Back button top left: "← Books"
- Hero section:
  - Cover image — larger (approx 90×134px), top left
  - Title, author, series + position, status badge — top right
- Scrollable detail body below hero:
  - Rating (tappable stars in final implementation)
  - Notes (free text)
  - Recommended by
  - Dates (started / finished)
  - Tags (pill chips)

*UI reference: the Books library widget shows the full list view with five example entries and tappable detail views for Project Hail Mary, Atomic Habits, and Children of Time.*

---

## 4. Movies & TV Library

Mirrors the Books library in structure and pattern. Stored separately from books.

### Data model — `Movie`

```ts
type Movie = {
  id: string
  title: string
  type: "movie" | "tv"
  director?: string               // or showrunner for TV
  year?: number
  runtime?: string                // e.g. "2h 46m" or "3 seasons"
  seasons?: number                // TV only
  currentSeason?: number          // TV — tracking progress
  currentEpisode?: number         // TV — tracking progress
  status: "maybe" | "watchlist" | "watching" | "seen"
  recommendedBy?: string
  rating?: number                 // 1–5
  notes?: string
  tags?: string[]
  streamingOn?: string[]          // e.g. ["Netflix", "Max"]
  coverUrl?: string               // poster image from TMDB
  dateWatched?: string
  dateAdded?: string
}
```

### Redis key
`library:shared:movies` — `Movie[]` full array, full-replace pattern.

*Note: movies are shared between Kevin and Kylie (like restaurants and books currently in Pinecone), unlike books which are per-user.*

### Cover art / metadata source
TMDB (The Movie Database) API — provides poster images, director, runtime, streaming availability. This is the standard choice for movie metadata.

### New chat intents needed
- `movie_add` — save a title to the watchlist with optional notes/recommended-by
- `movie_update` — update status, rating, notes, progress
- Update `movie_query` intent to read from structured Redis store

### Movies & TV library page — `/movies`

**List view:**
- Search bar: "Search titles, directors…"
- Filter chips: All / Watching / Watchlist / Seen it / Movies / TV
- Each row contains:
  - Poster thumbnail (left) — portrait orientation, sourced from TMDB
  - Title (bold)
  - Type + director/showrunner (e.g. "TV Series · Ben Stiller")
  - Season info or year/runtime (e.g. "Season 2 of 2" or "2023 · 3h")
  - Status badge (right) — Watching (amber), Watchlist (blue/purple), Seen it (green), Maybe (grey)
  - Star rating (right, below badge)

**Detail view:**
- Back button: "← Movies & TV"
- Hero: poster (larger), title, type/director, year/runtime, status badge, streaming service badge
- Detail body:
  - Rating
  - Progress (TV: "Season 2 · Episode 6 of 10")
  - Notes
  - Recommended by
  - Date watched
  - Where to watch (streaming service pills)
  - Tags

*UI reference: the Movies & TV library widget shows five example entries (Severance, Oppenheimer, Shōgun, Dune: Part Two, The Bear) with tappable detail views for the first four.*

---

## 5. Cover Art in Chat Responses

When Sonny returns information about a book or movie in chat — whether answering a question, making a recommendation, or confirming a save — it should display a structured card inline in the chat bubble rather than plain text.

### Book card (in chat)
- Thumbnail cover image (left, portrait)
- Title, author, series + position (right)
- Quick-action tags: "+ Add to list", "Audible" (if in library)
- "Recommended by Sonny" attribution carries through to the saved record automatically

### Movie card (in chat)
- Poster thumbnail (left)
- Title, type, director/year (right)
- Quick-action tags: "+ Add to watchlist", streaming service if known

*UI reference: the chat mockup (second nav widget) shows two book recommendation cards with the inline structure, cover placeholder, and quick-action tags.*

---

## 6. Admin / Edit Interface

A dedicated `/admin` route in the existing Next.js app for power-user editing of structured data. Protected by the same bearer auth as all other routes.

### Purpose
Chat is sufficient for quick adds and queries, but browsing and editing a 200-entry library (fixing a wrong series position, editing a recipe, correcting a movie's director) needs a real desktop UI.

### Structure
Single `/admin` page with tabs:
- **Books** — sortable/filterable table; click row to edit inline
- **Movies & TV** — same pattern
- **Recipes** — same pattern (a `/recipes` page already exists; the admin tab may replace or complement it)

### Behavior
- Desktop-oriented (not optimized for mobile)
- Full inline editing of all fields
- Ability to delete records
- For books: ability to manually trigger Audible sync for a single record or all records

---

## 7. Open Questions Before Implementation

- **Books shared or per-user?** Current assumption is per-user (`library:kevin:books`, `library:kylie:books`). Confirm this is correct — Kevin and Kylie may have different libraries.
- **Movies shared or per-user?** Current assumption is shared (`library:shared:movies`), consistent with how movies are currently stored in Pinecone. Confirm.
- **Meals icon:** Use fork and knife (matching Recipes icon style) or a different utensil combination to differentiate the two. Decide before implementation.
- **Audible finish-date gap:** Since Audible does not reliably expose finish date, the sync will infer `status: "finished"` from 100% progress. Confirm this is acceptable.
- **TMDB API key:** Will need to be added to environment variables for movie poster and metadata fetching.
- **Google Books / Open Library:** Confirm which API to use for book cover art. Open Library is free with no key; Google Books has higher quality but requires a key.
- **Kylie's Audible:** The `audible_library` intent is currently hardcoded to `kevin-audible` namespace. This will need to route by userId once Kylie's library is synced.
