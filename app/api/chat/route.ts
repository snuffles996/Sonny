// POST /api/chat
// Body: { message: string }
// Header: Authorization: Bearer <KEVIN_SECRET or KYLIE_SECRET>

import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getProfile } from "@/lib/profile/store";
import { classifyIntent } from "@/lib/anthropic/classify";
import { handleListWrite, handleListRead } from "@/lib/lists/handler";
import { addOverride } from "@/lib/lists/overrides";
import { addToListIndex } from "@/lib/lists/index";
import { searchUserLists } from "@/lib/lists/search";
import { addItemToList, isGroceryList, enrichmentSourceForList } from "@/lib/lists/addItem";
import { addStaples, removeStaples, getPantryStaples } from "@/lib/pantry/store";
import { generateResponse } from "@/lib/anthropic/respond";
import { getRecentTurns, appendTurn } from "@/lib/session/kv";
import { saveNote, searchNotes } from "@/lib/pinecone/records";
import { saveProfile } from "@/lib/profile/store";
import { extractProfileUpdate } from "@/lib/anthropic/profile";
import { getUpcomingEvents, createEvent, checkDuplicates, USER_TIMEZONE, type EventDraft } from "@/lib/caldav/events";
import { extractEventDetails } from "@/lib/anthropic/calendar";
import { isCalDAVConfigured } from "@/lib/caldav/client";
import { extractRecipeFromUrl, extractUrlFromMessage } from "@/lib/recipes/extract";
import { addRecipe } from "@/lib/recipes/store";
import { detectTeam, findGame, getScore, getSchedule, getStandings, getPlayerStats, getBulkSchedule, detectDivision, addHours } from "@/lib/sports/lookup";
import { parseDateRange } from "@/lib/anthropic/daterange";
import { extractSportsQuery } from "@/lib/anthropic/sports";
import { getActivePlan, saveActivePlan, clearActivePlan, saveGroceryList, clearGroceryList } from "@/lib/mealplan/store";
import { getCombinedExclusions } from "@/lib/mealplan/pantry";
import { selectMeals } from "@/lib/mealplan/select";
import { identifySwapTarget } from "@/lib/anthropic/mealplan";
import { getRecipes, setRecipes } from "@/lib/recipes/store";
import { buildGroceryList, formatGroceryListText } from "@/lib/mealplan/grocery";
import type { MealPlan, PlannedMeal } from "@/lib/mealplan/types";
import { searchBooks } from "@/lib/books/search";
import { searchAudibleLibrary } from "@/lib/books/audible-library";
import { getBooks, addBook, updateBook } from "@/lib/books/store";
import { searchMoviesAndTV } from "@/lib/movies/search";
import { getMovies, addMovie, updateMovie } from "@/lib/movies/store";
import { extractBookUpdate, extractMovieUpdate } from "@/lib/anthropic/library";
import type { ChatCard } from "@/lib/types/cards";
import type { Book } from "@/lib/books/types";
import type { Movie } from "@/lib/movies/types";
import { runWebSearch } from "@/lib/search/webSearch";
import { decideSave } from "@/lib/search/saveDecision";
import { saveSearchResult } from "@/lib/search/store";
import { autoSaveExchange } from "@/lib/notes/autoSave";
import {
  savePendingRecommender,
  getPendingRecommender,
  clearPendingRecommender,
} from "@/lib/notes/pendingRecommender";

// ── Recommender helpers ───────────────────────────────────────────────────────

function isMediaContent(message: string): boolean {
  return /\b(book|novel|read|reading|audiobook|movie|film|show|series|tv show|watch|watching|podcast|documentary|album|song|artist|band|listen|recommend)\b/i.test(message);
}

function extractRecommender(message: string): string | null {
  const patterns = [
    /recommended\s+by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+recommended/,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+told\s+me/i,
    /heard\s+(?:about\s+it\s+)?from\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+said\s+(?:I\s+should|to\s+(?:watch|read))/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

// ── Sports helpers ────────────────────────────────────────────────────────────

// Find the next game for a team within the next `lookaheadDays` days.
// Returns [game, dateStamp] or null if none found.
async function findNextGame(message: string, lookaheadDays = 7) {
  const team = detectTeam(message);
  if (!team) return null;

  const now = new Date();
  for (let i = 0; i < lookaheadDays; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    const stamp = d.toLocaleDateString("en-CA", { timeZone: USER_TIMEZONE }).replace(/-/g, "");
    const game = await findGame(team, stamp);
    if (game) return { game, team };
  }
  return null;
}

// ── Library helpers ───────────────────────────────────────────────────────────

function makeBookId(): string {
  return `book-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeMovieId(): string {
  return `movie-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findBookByTitle(books: Book[], title: string): Book | undefined {
  const norm = normalizeTitle(title);
  return books.find((b) => normalizeTitle(b.title).includes(norm) || norm.includes(normalizeTitle(b.title)));
}

function findMovieByTitle(movies: Movie[], title: string): Movie | undefined {
  const norm = normalizeTitle(title);
  return movies.find((m) => normalizeTitle(m.title).includes(norm) || norm.includes(normalizeTitle(m.title)));
}

async function fetchStreamingProviders(tmdbId: number, type: "movie" | "tv"): Promise<string[]> {
  try {
    const url = new URL(`https://api.themoviedb.org/3/${type}/${tmdbId}/watch/providers`);
    url.searchParams.set("api_key", process.env.TMDB_API_KEY!);
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = await res.json();
    const us = data.results?.US;
    if (!us) return [];
    const providers = new Set<string>();
    for (const s of [...(us.flatrate ?? []), ...(us.free ?? [])]) {
      providers.add((s as { provider_name: string }).provider_name);
    }
    return Array.from(providers);
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const message: string = body?.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  // Load profile, session turns, intent classification, context search, and list search all in parallel
  const [profile, recentTurns, classification, contextNotes, listContext] = await Promise.all([
    getProfile(userId),
    getRecentTurns(userId),
    classifyIntent(message),
    searchNotes(userId, message),       // speculative — used if intent is query
    searchUserLists(userId, message),   // speculative — injected alongside memory
  ]);
  const intent = classification.intent;

  let reply: string;
  let saved = false;
  let cards: ChatCard[] | undefined;

  // ── Pending recommender follow-up (intercepts before intent switch) ──────────
  // If the last response asked "who recommended it?" and the user replied with a
  // short answer (likely a name), complete the note with the recommender appended.
  const pendingRec = await getPendingRecommender(userId);
  if (pendingRec && message.trim().length <= 60) {
    await clearPendingRecommender(userId);
    const enrichedText = `${pendingRec.noteText} (Recommended by: ${message.trim()})`;
    await saveNote(userId, enrichedText);
    saved = true;
    reply = `Got it — noted that ${message.trim()} recommended it.`;
    await appendTurn(userId, { role: "user", content: message, timestamp: Date.now() });
    await appendTurn(userId, { role: "assistant", content: reply, timestamp: Date.now() });
    return NextResponse.json({ reply, intent, saved });  // no cards on recommender follow-up
  }
  if (pendingRec) await clearPendingRecommender(userId); // stale — long message means new topic

  switch (intent) {
    case "save_note": {
      await saveNote(userId, message);
      saved = true;
      const recommender = extractRecommender(message);
      if (recommender) {
        reply = `Saved — noted that ${recommender} recommended it.`;
      } else if (isMediaContent(message)) {
        await savePendingRecommender(userId, message);
        reply = "Got it, saved. Who recommended it?";
      } else {
        reply = "Got it, saved to your memory.";
      }
      break;
    }
    case "query": {
      reply = await generateResponse(message, profile, recentTurns, contextNotes, listContext);
      break;
    }
    case "calendar_read": {
      if (!isCalDAVConfigured()) {
        reply = "Calendar isn't connected yet — add CALDAV_USERNAME and CALDAV_PASSWORD to get started.";
      } else {
        try {
          const dateRange = parseDateRange(message);
          const events = await getUpcomingEvents(dateRange ?? undefined);
          reply = await generateResponse(message, profile, recentTurns, [events]);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("403")) {
            reply = "I couldn't access your calendar — the credentials may be wrong. Make sure CALDAV_PASSWORD is an app-specific password from appleid.apple.com, not your regular Apple ID password.";
          } else {
            reply = `Calendar error: ${msg}`;
          }
        }
      }
      break;
    }
    case "calendar_write": {
      if (!isCalDAVConfigured()) {
        reply = "Calendar isn't connected yet — add CALDAV_USERNAME and CALDAV_PASSWORD to get started.";
      } else {
        try {
          // Try to enrich with real game data if the message mentions a team
          const sportsResult = await findNextGame(message);
          const details = await extractEventDetails(message, sportsResult?.game);
          if (!details) {
            reply = "I wasn't sure what event to create — could you give me more details?";
          } else {
            await createEvent(details);
            // Format the event time for the confirmation message
            let timeLabel: string;
            if (details.allDay) {
              const d = details.startLocal.slice(0, 8);
              timeLabel = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`).toLocaleDateString("en-US", {
                weekday: "short", month: "short", day: "numeric", timeZone: USER_TIMEZONE,
              });
            } else {
              const s = details.startLocal; // "YYYYMMDDTHHMMSS"
              const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}`;
              timeLabel = new Date(iso).toLocaleString("en-US", {
                weekday: "short", month: "short", day: "numeric",
                hour: "numeric", minute: "2-digit", timeZone: USER_TIMEZONE,
              });
            }
            const locationNote = details.location ? ` at ${details.location}` : "";
            const espnNote = sportsResult?.game ? " (time from ESPN)" : "";
            reply = `Done — "${details.title}" added for ${timeLabel}${locationNote}.${espnNote}`;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("403")) {
            reply = "I couldn't write to your calendar — check that CALDAV_PASSWORD is an app-specific password from appleid.apple.com.";
          } else {
            reply = `Calendar error: ${msg}`;
          }
        }
      }
      break;
    }
    case "sports_query": {
      const sportsResult = await findNextGame(message);
      if (!sportsResult) {
        // No team detected or no game found — fall back to general response
        reply = await generateResponse(message, profile, recentTurns, contextNotes);
      } else {
        const { game, team } = sportsResult;
        const startLabel = new Date(game.startTimeUTC).toLocaleString("en-US", {
          weekday: "long", month: "short", day: "numeric",
          hour: "numeric", minute: "2-digit", timeZone: USER_TIMEZONE,
        });
        const homeAway = game.isHome ? "home vs." : "away @";
        const opponent = game.isHome ? game.awayTeam : game.homeTeam;
        reply = `Next ${team.fullName} game: **${homeAway} ${opponent}** — ${startLabel} at ${game.venue}.`;
      }
      break;
    }
    case "sports_score": {
      const team = detectTeam(message);
      if (!team) {
        reply = await generateResponse(message, profile, recentTurns, contextNotes);
      } else {
        const score = await getScore(team, 3); // scan last 3 days
        if (!score) {
          reply = `I couldn't find a recent ${team.fullName} score. They may not have played in the last few days.`;
        } else {
          reply = await generateResponse(message, profile, recentTurns, [
            `Score data for ${team.fullName}:\n${JSON.stringify(score, null, 2)}`,
          ]);
        }
      }
      break;
    }
    case "sports_schedule": {
      const team = detectTeam(message);
      if (!team) {
        reply = await generateResponse(message, profile, recentTurns, contextNotes);
      } else {
        const numMatch = message.match(/(\d+)\s*games?/i);
        const numGames = numMatch ? Math.min(parseInt(numMatch[1], 10), 20) : 5;
        const games = await getSchedule(team, numGames);
        if (games.length === 0) {
          reply = `I couldn't find any upcoming ${team.fullName} games.`;
        } else {
          reply = await generateResponse(message, profile, recentTurns, [
            `Upcoming ${team.fullName} schedule:\n${JSON.stringify(games, null, 2)}`,
          ]);
        }
      }
      break;
    }
    case "sports_standings": {
      const team = detectTeam(message);
      const divInfo = detectDivision(message);
      const sport = team?.sport ?? divInfo?.sport;
      if (!sport) {
        reply = await generateResponse(message, profile, recentTurns, contextNotes);
      } else {
        const standings = await getStandings(sport, divInfo?.division);
        if (standings.length === 0) {
          reply = `I couldn't fetch standings for that sport right now.`;
        } else {
          reply = await generateResponse(message, profile, recentTurns, [
            `Standings data:\n${JSON.stringify(standings, null, 2)}`,
          ]);
        }
      }
      break;
    }
    case "sports_player_stats": {
      const team = detectTeam(message);
      const extracted = await extractSportsQuery(message);
      const playerName = extracted.playerName ?? message;
      const sport = team?.sport ?? extracted.sport ?? "baseball/mlb";
      const stats = await getPlayerStats(playerName, sport);
      if (!stats) {
        reply = "I couldn't find stats for that player. Could you give me their full name or specify the sport?";
      } else {
        reply = await generateResponse(message, profile, recentTurns, [
          `Player stats:\n${JSON.stringify(stats, null, 2)}`,
        ]);
      }
      break;
    }
    case "sports_calendar_bulk": {
      if (!isCalDAVConfigured()) {
        reply = "Calendar isn't connected yet — add CALDAV_USERNAME and CALDAV_PASSWORD to get started.";
        break;
      }
      const bulkTeam = detectTeam(message);
      if (!bulkTeam) {
        reply = "I couldn't identify a team — which team's schedule would you like to add?";
        break;
      }
      const fullSchedule = await getBulkSchedule(bulkTeam);
      if (fullSchedule.length === 0) {
        reply = `I couldn't find any ${bulkTeam.fullName} games in the schedule.`;
        break;
      }
      // Filter to home/away if specified, otherwise use all
      const lowerMsg = message.toLowerCase();
      let filtered = fullSchedule;
      if (lowerMsg.includes("home game")) filtered = fullSchedule.filter((g) => g.homeAway === "home");
      else if (lowerMsg.includes("away game")) filtered = fullSchedule.filter((g) => g.homeAway === "away");

      // Build event drafts
      const drafts: EventDraft[] = filtered.map((g) => ({
        title: g.homeAway === "home"
          ? `${bulkTeam.fullName} vs ${g.opponent}`
          : `${bulkTeam.fullName} @ ${g.opponent}`,
        startLocal: g.startLocal,
        endLocal: addHours(g.startLocal, bulkTeam.gameDurationHours),
        allDay: false,
        timezone: USER_TIMEZONE,
        location: g.venue,
      }));

      // Date range for dedup query
      const dates = filtered.map((g) => new Date(g.date).getTime()).filter((t) => !isNaN(t));
      const rangeFrom = new Date(Math.min(...dates));
      const rangeTo = new Date(Math.max(...dates) + 86400000);
      const { toCreate, toSkip } = await checkDuplicates(drafts, rangeFrom, rangeTo);

      // Batch create with concurrency limit of 5
      const CONCURRENCY = 5;
      let created = 0;
      let failed = 0;
      for (let i = 0; i < toCreate.length; i += CONCURRENCY) {
        const batch = toCreate.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(batch.map((d) => createEvent(d)));
        for (const r of results) {
          if (r.status === "fulfilled") created++;
          else failed++;
        }
      }

      reply = `Added ${created} ${bulkTeam.fullName} game${created !== 1 ? "s" : ""} to your calendar.`;
      if (toSkip.length > 0) reply += ` Skipped ${toSkip.length} already there.`;
      if (failed > 0) reply += ` ${failed} failed to create.`;
      break;
    }
    case "profile_update": {
      const updates = await extractProfileUpdate(message, profile);
      if (Object.keys(updates).length === 0) {
        reply = "I wasn't sure what to update — could you be more specific?";
      } else {
        await saveProfile(userId, updates);
        reply = "Got it, your profile has been updated.";
      }
      break;
    }
    case "recipe_add": {
      const url = extractUrlFromMessage(message);
      if (!url) {
        reply = "I didn't find a URL in your message — paste the recipe link and I'll add it.";
      } else {
        const recipe = await extractRecipeFromUrl(url);
        if (!recipe) {
          reply = "I wasn't able to fetch that recipe — the site may be blocking requests. You can try a different link.";
        } else {
          await addRecipe(recipe);
          reply = `Added **${recipe.name}** to your recipes.${recipe.cuisine ? ` (${recipe.cuisine})` : ""}`;
        }
      }
      break;
    }
    case "meal_plan_create": {
      const [recipes, activePlan] = await Promise.all([getRecipes(), getActivePlan()]);
      const countMatch = message.match(/(\d+)\s*meals?/i);
      const mealCount = countMatch ? Math.min(parseInt(countMatch[1], 10), 7) : 4;

      // Attempt calendar awareness for busy nights
      let busyNights: string[] = [];
      if (isCalDAVConfigured()) {
        try {
          const eventsStr = await getUpcomingEvents(7);
          // Count bullet points per date prefix to find days with 2+ events
          const dateLines = eventsStr.match(/^• .+$/gm) ?? [];
          const dateCounts: Record<string, number> = {};
          for (const line of dateLines) {
            const dateKey = line.slice(2, 15); // "Mon, Apr 10" prefix
            dateCounts[dateKey] = (dateCounts[dateKey] ?? 0) + 1;
          }
          busyNights = Object.entries(dateCounts)
            .filter(([, count]) => count >= 2)
            .map(([date]) => date);
        } catch { /* continue without calendar awareness */ }
      }

      const suggestions = await selectMeals({
        allRecipes: recipes,
        activePlan,
        profile,
        busyNights,
        count: mealCount,
        preferences: message,
      });

      if (suggestions.length === 0) {
        reply = "I couldn't find enough recipes that match your preferences. Try adding more recipes or adjusting your dietary settings.";
        break;
      }

      const planMeals: PlannedMeal[] = suggestions.map((s) => ({
        recipeSlug: s.recipe.slug,
        recipeName: s.recipe.name,
        addedBy: userId,
        made: false,
      }));

      const defaultServings = parseInt(process.env.DEFAULT_SERVINGS ?? "2", 10);
      const newPlan: MealPlan = {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: userId,
        meals: planMeals,
        servings: defaultServings,
      };
      await saveActivePlan(newPlan);
      await clearGroceryList();

      const lines = suggestions.map((s, i) => {
        const meta = [s.recipe.cuisine, s.recipe.totalTime].filter(Boolean).join(", ");
        const quick = s.quickMeal ? " ⚡" : "";
        return `${i + 1}. **${s.recipe.name}**${meta ? ` (${meta})` : ""}${quick}\n   _${s.reason}_`;
      });
      reply = `Here's a ${suggestions.length}-meal plan:\n\n${lines.join("\n\n")}\n\nLet me know if you'd like to swap any of these out.`;
      break;
    }
    case "meal_plan_swap": {
      const swapPlan = await getActivePlan();
      if (!swapPlan || swapPlan.meals.length === 0) {
        reply = "There's no active meal plan to swap. Want me to create one?";
        break;
      }
      const targetSlug = await identifySwapTarget(message, swapPlan.meals);
      if (!targetSlug) {
        reply = "I wasn't sure which meal you wanted to swap — could you be more specific?";
        break;
      }
      const swapRecipes = await getRecipes();
      const replacement = await selectMeals({
        allRecipes: swapRecipes,
        activePlan: swapPlan,
        profile,
        busyNights: [],
        count: 1,
        preferences: message,
      });
      if (replacement.length === 0) {
        reply = "I couldn't find a suitable replacement. Try again with a different preference.";
        break;
      }
      const newMeal = replacement[0];
      const idx = swapPlan.meals.findIndex((m) => m.recipeSlug === targetSlug);
      const oldName = swapPlan.meals[idx]?.recipeName ?? targetSlug;
      swapPlan.meals[idx] = {
        recipeSlug: newMeal.recipe.slug,
        recipeName: newMeal.recipe.name,
        addedBy: userId,
        made: false,
      };
      swapPlan.updatedAt = new Date().toISOString();
      swapPlan.updatedBy = userId;
      await saveActivePlan(swapPlan);
      await clearGroceryList();
      reply = `Swapped **${oldName}** for **${newMeal.recipe.name}**. ${newMeal.reason}`;
      break;
    }
    case "meal_plan_grocery": {
      const groceryPlan = await getActivePlan();
      if (!groceryPlan || groceryPlan.meals.length === 0) {
        reply = "There's no active meal plan to build a grocery list from. Want me to plan some meals first?";
        break;
      }
      const [groceryRecipes, groceryExclusions] = await Promise.all([getRecipes(), getCombinedExclusions()]);
      const groceryItems = await buildGroceryList(groceryPlan.meals, groceryRecipes, groceryPlan.servings, groceryExclusions);
      if (groceryItems.length === 0) {
        reply = "I couldn't parse ingredients from the current plan's recipes. The recipes may be missing an Ingredients section.";
        break;
      }
      await saveGroceryList(groceryItems);

      const listText = formatGroceryListText(groceryItems);
      reply = `Here's your grocery list for ${groceryPlan.meals.length} meal${groceryPlan.meals.length !== 1 ? "s" : ""} (${groceryPlan.servings} servings each):\n\n${listText}`;
      break;
    }
    case "meal_plan_clear": {
      const clearPlan = await getActivePlan();
      if (!clearPlan) {
        reply = "There's no active meal plan to clear.";
        break;
      }
      await clearActivePlan(userId);
      reply = "Meal plan cleared. Want to start a new one?";
      break;
    }
    case "book_search": {
      try {
        const [results, library] = await Promise.all([
          searchBooks(message),
          getBooks(userId),
        ]);
        if (results.length === 0) {
          reply = "I couldn't find any books matching that. Try a different search term.";
        } else {
          reply = await generateResponse(message, profile, recentTurns, [
            `Google Books results:\n${JSON.stringify(results, null, 2)}`,
          ]);
          cards = results.slice(0, 3).map((r): ChatCard => {
            const inLib = !!findBookByTitle(library, r.title);
            const coverUrl = r.isbn ? `https://covers.openlibrary.org/b/isbn/${r.isbn}-M.jpg` : undefined;
            return {
              type: "book",
              title: r.title,
              subtitle: r.authors.length > 0 ? `by ${r.authors[0]}` : "",
              coverUrl,
              inLibrary: inLib,
              actions: inLib ? [] : [{
                label: "+ Add to library",
                action: "add_book",
                payload: {
                  id: makeBookId(),
                  title: r.title,
                  author: r.authors[0] ?? "Unknown",
                  isbn: r.isbn,
                  coverUrl,
                  status: "want_to_read",
                  source: "other",
                  dateAdded: new Date().toISOString().slice(0, 10),
                } satisfies Partial<Book>,
              }],
            };
          });
        }
      } catch (err) {
        reply = `Book search failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      break;
    }
    case "audible_library": {
      try {
        // Check structured Redis store first (populated by updated sync script)
        const library = await getBooks(userId);
        const q = message.toLowerCase();
        const redisMatches = library.filter(
          (b) => b.source === "audible" && (
            b.title.toLowerCase().includes(q) ||
            b.author.toLowerCase().includes(q) ||
            (b.series ?? "").toLowerCase().includes(q)
          )
        );
        if (redisMatches.length > 0) {
          reply = await generateResponse(message, profile, recentTurns, [
            `Your Audible library matches:\n${JSON.stringify(redisMatches, null, 2)}`,
          ]);
        } else {
          // Fall back to Pinecone (legacy — shrinks as Redis store fills)
          const books = await searchAudibleLibrary(message);
          if (books.length === 0) {
            reply = "I couldn't find a match in your Audible library. Try different keywords, or the library may not be synced yet.";
          } else {
            reply = await generateResponse(message, profile, recentTurns, [
              `Your Audible library matches:\n${JSON.stringify(books, null, 2)}`,
            ]);
          }
        }
      } catch (err) {
        reply = `Audible library search failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      break;
    }
    case "movie_query": {
      try {
        const [results, library] = await Promise.all([
          searchMoviesAndTV(message),
          getMovies(),
        ]);
        if (results.length === 0) {
          reply = "I couldn't find anything matching that on TMDb.";
        } else {
          reply = await generateResponse(message, profile, recentTurns, [
            `TMDb results:\n${JSON.stringify(results, null, 2)}`,
          ]);
          cards = results.slice(0, 3).map((r): ChatCard => {
            const inLib = !!findMovieByTitle(library, r.title);
            return {
              type: "movie",
              title: r.title,
              subtitle: [r.releaseDate ? String(new Date(r.releaseDate).getFullYear()) : null, r.type === "tv" ? "TV Series" : "Movie"].filter(Boolean).join(" · "),
              coverUrl: r.posterUrl ?? undefined,
              inLibrary: inLib,
              actions: inLib ? [] : [{
                label: "+ Add to watchlist",
                action: "add_movie",
                payload: {
                  id: makeMovieId(),
                  title: r.title,
                  type: r.type,
                  year: r.releaseDate ? new Date(r.releaseDate).getFullYear() : undefined,
                  seasons: r.seasons,
                  runtime: r.runtime ? `${Math.floor(r.runtime / 60)}h ${r.runtime % 60}m` : undefined,
                  coverUrl: r.posterUrl ?? undefined,
                  tmdbId: r.id,
                  status: "watchlist",
                  dateAdded: new Date().toISOString().slice(0, 10),
                } satisfies Partial<Movie>,
              }],
            };
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        reply = msg.includes("TMDB_API_KEY")
          ? "Movie search isn't set up yet — add TMDB_API_KEY to your environment variables (free at themoviedb.org/settings/api)."
          : `Movie search failed: ${msg}`;
      }
      break;
    }
    case "book_add": {
      try {
        const titles = classification.bookTitles?.length ? classification.bookTitles : [message];
        const recommender = extractRecommender(message);
        const today = new Date().toISOString().slice(0, 10);

        // Parallel searches — one per title
        const searchResults = await Promise.all(titles.map((t) => searchBooks(t).catch(() => [])));

        const addedBooks: Book[] = [];
        const notFound: string[] = [];

        for (let i = 0; i < titles.length; i++) {
          const top = searchResults[i][0];
          if (!top) { notFound.push(titles[i]); continue; }
          const isbn = top.isbn;
          const coverUrl = isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg` : undefined;
          const book: Book = {
            id: makeBookId(),
            title: top.title,
            author: top.authors[0] ?? "Unknown",
            isbn,
            coverUrl,
            status: "want_to_read",
            source: "other",
            recommendedBy: recommender ?? undefined,
            dateAdded: today,
          };
          await addBook(userId, book);
          addedBooks.push(book);
        }

        saved = addedBooks.length > 0;
        const recPart = recommender ? ` (recommended by ${recommender})` : "";
        const notFoundPart = notFound.length > 0 ? ` Couldn't find: ${notFound.join(", ")}.` : "";

        if (addedBooks.length === 1) {
          reply = `Added *${addedBooks[0].title}* by ${addedBooks[0].author} to your library${recPart}. View it at /books.${notFoundPart}`;
        } else if (addedBooks.length > 1) {
          const list = addedBooks.map((b) => `*${b.title}*`).join(", ");
          reply = `Added ${addedBooks.length} books to your library${recPart}: ${list}. View them at /books.${notFoundPart}`;
        } else {
          reply = `Couldn't find any of those books. Try the full title or author name.`;
        }

        cards = addedBooks.map((b): ChatCard => ({
          type: "book",
          title: b.title,
          subtitle: `by ${b.author}`,
          coverUrl: b.coverUrl,
          inLibrary: true,
          actions: [],
        }));
      } catch (err) {
        reply = `Couldn't add those books: ${err instanceof Error ? err.message : String(err)}`;
      }
      break;
    }
    case "book_update": {
      try {
        const extraction = await extractBookUpdate(message);
        const library = await getBooks(userId);
        const today = new Date().toISOString().slice(0, 10);

        const updates: Partial<Book> = {};
        if (extraction.status) updates.status = extraction.status;
        if (extraction.rating != null) updates.rating = extraction.rating;
        if (extraction.notes) updates.notes = extraction.notes;
        if (extraction.setDateStarted) updates.dateStarted = today;
        if (extraction.setDateFinished) updates.dateFinished = today;

        const matched: Book[] = [];
        const notFound: string[] = [];
        for (const title of extraction.titles) {
          const match = findBookByTitle(library, title);
          if (!match) { notFound.push(title); continue; }
          matched.push(match);
        }

        await Promise.all(matched.map((m) => updateBook(userId, m.id, updates)));

        const statusMsg = extraction.status ? ` Status: ${extraction.status.replace(/_/g, " ")}.` : "";
        const notFoundPart = notFound.length > 0 ? ` (Couldn't find: ${notFound.join(", ")})` : "";

        if (matched.length === 1) {
          reply = `Updated *${matched[0].title}*.${statusMsg}${notFoundPart}`;
        } else if (matched.length > 1) {
          reply = `Updated ${matched.length} books: ${matched.map((m) => `*${m.title}*`).join(", ")}.${statusMsg}${notFoundPart}`;
        } else {
          reply = `Couldn't find ${extraction.titles.length === 1 ? `*${extraction.titles[0]}*` : "any of those books"} in your library. Want me to add ${extraction.titles.length === 1 ? "it" : "them"} first?`;
        }
      } catch (err) {
        reply = `Couldn't update those books: ${err instanceof Error ? err.message : String(err)}`;
      }
      break;
    }
    case "movie_add": {
      try {
        const titles = classification.movieTitles?.length ? classification.movieTitles : [message];
        const recommender = extractRecommender(message);
        const today = new Date().toISOString().slice(0, 10);

        // Parallel TMDB searches
        const searchResults = await Promise.all(
          titles.map((t) => searchMoviesAndTV(t).catch(() => []))
        );

        // Parallel streaming provider fetches for found results
        const tops = searchResults.map((r) => r[0] ?? null);
        const streamingResults = await Promise.all(
          tops.map((top) => (top?.id ? fetchStreamingProviders(top.id, top.type) : Promise.resolve([])))
        );

        const addedMovies: Movie[] = [];
        const notFound: string[] = [];

        for (let i = 0; i < titles.length; i++) {
          const top = tops[i];
          if (!top) { notFound.push(titles[i]); continue; }
          const streaming = streamingResults[i];
          const movie: Movie = {
            id: makeMovieId(),
            title: top.title,
            type: top.type,
            year: top.releaseDate ? new Date(top.releaseDate).getFullYear() : undefined,
            seasons: top.seasons,
            runtime: top.runtime ? `${Math.floor(top.runtime / 60)}h ${top.runtime % 60}m` : undefined,
            coverUrl: top.posterUrl ?? undefined,
            tmdbId: top.id,
            status: "watchlist",
            recommendedBy: recommender ?? undefined,
            streamingOn: streaming.length > 0 ? streaming : undefined,
            dateAdded: today,
          };
          await addMovie(movie);
          addedMovies.push(movie);
        }

        saved = addedMovies.length > 0;
        const recPart = recommender ? ` (recommended by ${recommender})` : "";
        const notFoundPart = notFound.length > 0 ? ` Couldn't find: ${notFound.join(", ")}.` : "";

        if (addedMovies.length === 1) {
          const streaming = addedMovies[0].streamingOn;
          const streamPart = streaming?.length ? ` Available on ${streaming.slice(0, 2).join(", ")}.` : "";
          reply = `Added *${addedMovies[0].title}* to your watchlist${recPart}.${streamPart} View it at /movies.${notFoundPart}`;
        } else if (addedMovies.length > 1) {
          const list = addedMovies.map((m) => `*${m.title}*`).join(", ");
          reply = `Added ${addedMovies.length} titles to your watchlist${recPart}: ${list}. View them at /movies.${notFoundPart}`;
        } else {
          reply = `Couldn't find any of those on TMDb. Try the full title.`;
        }

        cards = addedMovies.map((m): ChatCard => ({
          type: "movie",
          title: m.title,
          subtitle: [m.year, m.type === "tv" ? "TV Series" : "Movie"].filter(Boolean).join(" · "),
          coverUrl: m.coverUrl,
          inLibrary: true,
          actions: [],
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        reply = msg.includes("TMDB_API_KEY")
          ? "Movie search isn't set up yet — add TMDB_API_KEY to your environment variables."
          : `Couldn't add those movies: ${msg}`;
      }
      break;
    }
    case "movie_update": {
      try {
        const extraction = await extractMovieUpdate(message);
        const library = await getMovies();
        const today = new Date().toISOString().slice(0, 10);

        const updates: Partial<Movie> = {};
        if (extraction.status) updates.status = extraction.status;
        if (extraction.rating != null) updates.rating = extraction.rating;
        if (extraction.notes) updates.notes = extraction.notes;
        if (extraction.currentSeason != null) updates.currentSeason = extraction.currentSeason;
        if (extraction.currentEpisode != null) updates.currentEpisode = extraction.currentEpisode;
        if (extraction.setDateWatched) updates.dateWatched = today;

        const matched: Movie[] = [];
        const notFound: string[] = [];
        for (const title of extraction.titles) {
          const match = findMovieByTitle(library, title);
          if (!match) { notFound.push(title); continue; }
          matched.push(match);
        }

        await Promise.all(matched.map((m) => updateMovie(m.id, updates)));

        const statusMsg = extraction.status ? ` Status: ${extraction.status}.` : "";
        const progressMsg = extraction.currentSeason != null
          ? ` Progress: S${extraction.currentSeason}${extraction.currentEpisode != null ? `E${extraction.currentEpisode}` : ""}.`
          : "";
        const notFoundPart = notFound.length > 0 ? ` (Couldn't find: ${notFound.join(", ")})` : "";

        if (matched.length === 1) {
          reply = `Updated *${matched[0].title}*.${statusMsg}${progressMsg}${notFoundPart}`;
        } else if (matched.length > 1) {
          reply = `Updated ${matched.length} titles: ${matched.map((m) => `*${m.title}*`).join(", ")}.${statusMsg}${notFoundPart}`;
        } else {
          reply = `Couldn't find ${extraction.titles.length === 1 ? `*${extraction.titles[0]}*` : "any of those titles"} in the library. Want me to add ${extraction.titles.length === 1 ? "it" : "them"} first?`;
        }
      } catch (err) {
        reply = `Couldn't update those titles: ${err instanceof Error ? err.message : String(err)}`;
      }
      break;
    }
    case "library_stats": {
      const [bookLib, movieLib] = await Promise.all([getBooks(userId), getMovies()]);
      const bookCounts = { reading: 0, want_to_read: 0, finished: 0, shelf: 0 };
      for (const b of bookLib) bookCounts[b.status]++;
      const movieCounts = { watching: 0, watchlist: 0, seen: 0, maybe: 0 };
      for (const m of movieLib) movieCounts[m.status]++;
      reply = [
        `**Books** (${bookLib.length} total)`,
        `Reading: ${bookCounts.reading} · Want to read: ${bookCounts.want_to_read} · Finished: ${bookCounts.finished} · On shelf: ${bookCounts.shelf}`,
        ``,
        `**Movies & TV** (${movieLib.length} total)`,
        `Watching: ${movieCounts.watching} · Watchlist: ${movieCounts.watchlist} · Seen: ${movieCounts.seen} · Maybe: ${movieCounts.maybe}`,
      ].join("\n");
      break;
    }
    case "web_search": {
      try {
        const result = await runWebSearch(message, profile, recentTurns);
        reply = result.responseText || "I couldn't find anything useful for that search.";
        // Fire-and-forget: decide whether to save — non-critical, don't block response
        void (async () => {
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
          } catch { /* non-fatal */ }
        })();
      } catch (err) {
        reply = `Web search failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      break;
    }
    case "list_write": {
      const listName = classification.listName ?? "general";
      const items = classification.items ?? [];
      if (isGroceryList(listName)) {
        // Grocery lists: keep the categorize-and-confirm flow
        reply = await handleListWrite(userId, listName, items);
        await addToListIndex(userId, listName);
      } else if (items.length === 1) {
        // Non-grocery, single item: try enrichment
        const result = await addItemToList({
          userId,
          listName,
          itemName: items[0],
          itemType: enrichmentSourceForList(listName) === "tmdb" ? "show/movie" : "other",
          enrichmentSource: enrichmentSourceForList(listName),
        });
        reply = result.reply;
      } else {
        // Non-grocery, multiple items: write all, skip per-item enrichment
        reply = await handleListWrite(userId, listName, items);
        await addToListIndex(userId, listName);
      }
      break;
    }
    case "list_read": {
      reply = await handleListRead(userId, classification.listName);
      break;
    }
    case "categorization_correction": {
      if (classification.correctionItem && classification.correctionCategory) {
        await addOverride(classification.correctionItem, classification.correctionCategory);
        reply = `Got it — I'll put ${classification.correctionItem} in ${classification.correctionCategory} from now on.`;
      } else {
        reply = "I didn't catch which item or category you meant. Can you say it again?";
      }
      break;
    }
    case "staples_update": {
      if (classification.staplesAction === "add" && classification.staplesItems?.length) {
        const updated = await addStaples(classification.staplesItems);
        reply = `Added to pantry staples: ${classification.staplesItems.join(", ")}. You now have ${updated.length} staples on record.`;
      } else if (classification.staplesAction === "remove" && classification.staplesItems?.length) {
        await removeStaples(classification.staplesItems);
        reply = `Removed from pantry staples: ${classification.staplesItems.join(", ")}.`;
      } else {
        reply = "I didn't catch what you wanted to add or remove from staples.";
      }
      break;
    }
    case "staples_read": {
      const staples = await getPantryStaples();
      reply = `Your pantry staples (${staples.length} items):\n${staples.join(", ")}`;
      break;
    }
    default: {
      reply = await generateResponse(message, profile, recentTurns, contextNotes);
    }
  }

  // Persist turns sequentially to preserve order
  await appendTurn(userId, { role: "user", content: message, timestamp: Date.now() });
  await appendTurn(userId, { role: "assistant", content: reply, timestamp: Date.now() });

  // Fire-and-forget auto-save: persist notable exchanges to Pinecone with a date prefix.
  // Skip intents that already write to a dedicated store (lists, calendar, web search, etc.)
  const AUTO_SAVE_SKIP = new Set<string>([
    "save_note",        // already saved explicitly
    "list_write",       // saved to Redis lists
    "calendar_write",   // saved to CalDAV
    "web_search",       // has its own decideSave flow
    "staples_update",   // saved to Redis pantry
    "recipe_add",       // saved to Redis recipes
    "book_add",         // saved to Redis library
    "book_update",      // saved to Redis library
    "movie_add",        // saved to Redis library
    "movie_update",     // saved to Redis library
    "list_read", "staples_read", "calendar_read", "library_stats", // read-only
    "meal_plan_clear",
  ]);
  if (!AUTO_SAVE_SKIP.has(intent)) {
    const dateLabel = new Date().toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric", timeZone: USER_TIMEZONE,
    });
    void (async () => {
      try {
        await autoSaveExchange(userId, message, reply, dateLabel);
      } catch { /* non-fatal */ }
    })();
  }

  return NextResponse.json({ reply, intent, saved, ...(cards ? { cards } : {}) });
}
