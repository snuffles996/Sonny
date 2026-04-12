# Sonny — Outstanding Work
**Last updated: April 2026**

Items carried forward from completed dev plans plus new ideas. Grouped roughly by effort.

---

## Quick wins

- **Folk unit dictionary in Redis** — currently hardcoded in `lib/mealplan/grocery.ts`. Moving it to Redis would make it editable via chat without a redeploy. Useful as edge cases accumulate (e.g. "sachet", "packet", "stalk").

- **Unit import cleanup** — the ~68 imported recipes may have inconsistent units from scraping. A one-time script that runs the grocery normalization pass over all stored recipes and writes back cleaned ingredient text. Non-blocking (grocery logic handles mixed units gracefully), but cleaner source data means fewer `qty + folk` fallbacks.

- **Event creation feedback** — after a CalDAV PUT, the confirmation message is generic ("Done — event added"). Return the actual created event title + date/time instead. Surface real CalDAV errors instead of generic failure messages.

---

## Features

- **Weekly briefing cron** — the Monday 8am cron at `app/api/cron/route.ts` is a stub. Should pull the active shared meal plan + upcoming calendar events and send a Monday summary to both Kevin and Kylie (push notification or chat message).

- **Movies / Books UI tabs** — `book_search`, `audible_library`, and `movie_query` work via chat but have no dedicated UI pages. Could be a combined `/media` page with sub-tabs for Books, Audible, and Movies — similar to the Recipes tab. Low priority while chat works fine.

- **Breakfast / lunch support** — `PlannedMeal` has no `mealType` field. When added, lunch could be free-text notes rather than recipe slugs, and breakfast a simple "did we prep?" toggle. Leave the model extensible but don't break existing meal cards.

- **Kylie's Audible library** — `kevin-audible` namespace is seeded. When Kylie wants her library searchable, run the same `fetch-audible-library.py` + `sync-audible.mjs` flow under a `kylie-audible` namespace. The `audible_library` handler in `route.ts` is currently hardcoded to `kevin-audible` — parameterize by `userId`.

---

## Infrastructure / polish

- **Shared Reminders list setup** — the Reminders push works, but for Kevin and Kylie to see the same grocery list in real time, the iCloud Reminders list needs to be shared between their Apple IDs. This is an offline iCloud setup step, not a code change.

- **Vercel async save for web search** — the fire-and-forget `void (async () => {...})()` pattern in the `web_search` handler may get cut off when Vercel terminates the serverless function after the response is sent. Options: (a) accept occasional missed saves (it's best-effort), or (b) move the save into a separate internal `POST /api/search/save` endpoint and fire-and-forget with `fetch()`.

- **`DEFAULT_SERVINGS` env var** — not yet added to `.env.local` or Vercel. Currently falls back to `2` in code. Add explicitly if the default needs changing.

---

## Open questions

- **Future bottom nav tabs** — nav currently has Chat, Recipes, Meals, Skin. If Movies/Books get UI pages, the nav needs to expand or reorganize. Don't hardcode a fixed layout.
- **Kylie's account setup** — `KYLIE_SECRET` should be set in Vercel env vars when Kylie starts using the app directly.
