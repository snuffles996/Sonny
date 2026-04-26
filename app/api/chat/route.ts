// POST /api/chat
// Body: { message: string; confirmAction?: PendingAction }
// Header: Authorization: Bearer <KEVIN_SECRET or KYLIE_SECRET>

import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getProfile } from "@/lib/profile/store";
import { classifyIntent } from "@/lib/anthropic/classify";
import { handleListWrite, handleListRead } from "@/lib/lists/handler";
import { addOverride } from "@/lib/lists/overrides";
import { addToListIndex } from "@/lib/lists/index";
import { addItemToList, isGroceryList, enrichmentSourceForList } from "@/lib/lists/addItem";
import { addStaples, removeStaples, getPantryStaples } from "@/lib/pantry/store";
import { generateResponse, generateConversationalResponse } from "@/lib/anthropic/respond";
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
import { waitUntil } from "@vercel/functions";
import { runWebSearch } from "@/lib/search/webSearch";
import { decideSave } from "@/lib/search/saveDecision";
import { saveSearchResult } from "@/lib/search/store";
import { autoSaveExchange } from "@/lib/notes/autoSave";
import {
  savePendingRecommender,
  getPendingRecommender,
  clearPendingRecommender,
} from "@/lib/notes/pendingRecommender";
import { loadBroadContext } from "@/lib/anthropic/context";
import { executeConfirmedAction } from "@/lib/anthropic/execute";
import type { PendingAction } from "@/lib/anthropic/actions";

// Intents handled on the structural fast-path (Haiku classify → existing handler).
// Everything else falls through to the Claude-first conversational path.
const STRUCTURAL_INTENTS = new Set([
  "sports_query",
  "sports_score",
  "sports_schedule",
  "sports_standings",
  "sports_player_stats",
  "sports_calendar_bulk",
  "meal_plan_create",
  "meal_plan_swap",
  "meal_plan_grocery",
  "meal_plan_clear",
  "staples_read",
  "staples_update",
  "profile_update",
  "calendar_read",
  "library_stats",
  "list_read",
  "categorization_correction",
  "web_search",
  "recipe_add",
  "audible_library",
  "book_search",
  "movie_query",
]);

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
  const confirmAction: PendingAction | undefined = body?.confirmAction;

  if (!message) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  // ── Confirmed action early return ─────────────────────────────────────────────
  // Client sends confirmAction when the user taps Confirm on a pending action.
  // Don't persist these turns — "confirmed" + "Added X as watching" are mechanical,
  // not conversational, and would eat session window slots.
  if (confirmAction) {
    const result = await executeConfirmedAction(confirmAction, userId);
    return NextResponse.json({ reply: result.reply });
  }

  // ── Pending recommender follow-up (intercepts before intent switch) ──────────
  // If the last response asked "who recommended it?" and the user replied with a
  // short answer (likely a name), complete the note with the recommender appended.
  const pendingRec = await getPendingRecommender(userId);
  if (pendingRec && message.trim().length <= 60) {
    await clearPendingRecommender(userId);
    const enrichedText = `${pendingRec.noteText} (Recommended by: ${message.trim()})`;
    await saveNote(userId, enrichedText);
    const recReply = `Got it — noted that ${message.trim()} recommended it.`;
    await appendTurn(userId, { role: "user", content: message, timestamp: Date.now() });
    await appendTurn(userId, { role: "assistant", content: recReply, timestamp: Date.now() });
    return NextResponse.json({ reply: recReply, intent: "save_note", saved: true });
  }
  if (pendingRec) await clearPendingRecommender(userId); // stale — long message means new topic

  // ── Parallel context load ─────────────────────────────────────────────────────
  const [profile, recentTurns, broadContext, classification] = await Promise.all([
    getProfile(userId),
    getRecentTurns(userId),
    loadBroadContext(userId, message),
    classifyIntent(message),
  ]);
  const intent = classification.intent;

  let reply: string | undefined;
  let saved = false;
  let cards: ChatCard[] | undefined;
  let pendingAction: PendingAction | undefined;

  // ── Structural fast-path: high-confidence commands bypass Claude reasoning ────
  if (classification.confidence === "high" && STRUCTURAL_INTENTS.has(intent)) {
    switch (intent) {
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
    case "sports_query": {
      const sportsResult = await findNextGame(message);
      if (!sportsResult) {
        // No team detected or no game found — fall back to general response
        reply = await generateResponse(message, profile, recentTurns, broadContext.notes.map((m) => m.text));
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
        reply = await generateResponse(message, profile, recentTurns, broadContext.notes.map((m) => m.text));
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
        reply = await generateResponse(message, profile, recentTurns, broadContext.notes.map((m) => m.text));
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
        reply = await generateResponse(message, profile, recentTurns, broadContext.notes.map((m) => m.text));
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
            const coverUrl = r.coverUrl ?? (r.isbn ? `https://covers.openlibrary.org/b/isbn/${r.isbn}-M.jpg` : undefined);
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
          cards = redisMatches.slice(0, 3).map((b): ChatCard => ({
            type: "book",
            title: b.title,
            subtitle: `by ${b.author}`,
            coverUrl: b.coverUrl ?? (b.isbn ? `https://covers.openlibrary.org/b/isbn/${b.isbn}-M.jpg` : undefined),
            status: b.status,
            inLibrary: true,
            actions: [],
          }));
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
        waitUntil((async () => {
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
        })());
      } catch (err) {
        reply = `Web search failed: ${err instanceof Error ? err.message : String(err)}`;
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
    } // end structural switch
  } // end structural fast-path

  // ── Conversational path: Claude reasons from broad context ────────────────────
  if (reply === undefined) {
    const result = await generateConversationalResponse({
      userId,
      message,
      profile,
      recentTurns,
      broadContext,
    });
    reply = result.reply;
    pendingAction = result.pendingAction ?? undefined;

    // Generate preview cards for pending movie_add / book_add proposals so the
    // user sees a visual card alongside the "Want me to add it?" message.
    if (pendingAction?.type === "movie_add") {
      const title = pendingAction.payload.title as string | undefined;
      if (title) {
        try {
          const [results, library] = await Promise.all([
            searchMoviesAndTV(title).catch(() => []),
            getMovies(),
          ]);
          if (results.length > 0) {
            cards = results.slice(0, 3).map((r): ChatCard => {
              const inLib = !!findMovieByTitle(library, r.title);
              return {
                type: "movie",
                title: r.title,
                subtitle: [r.releaseDate ? String(new Date(r.releaseDate).getFullYear()) : null, r.type === "tv" ? "TV Series" : "Movie"].filter(Boolean).join(" · "),
                coverUrl: r.posterUrl ?? undefined,
                inLibrary: inLib,
                actions: [],
              };
            });
          }
        } catch { /* non-fatal — cards are optional */ }
      }
    } else if (pendingAction?.type === "book_add") {
      const title = pendingAction.payload.title as string | undefined;
      const author = pendingAction.payload.author as string | undefined;
      if (title) {
        try {
          const [results, library] = await Promise.all([
            searchBooks(author ? `${title} ${author}` : title).catch(() => []),
            getBooks(userId),
          ]);
          if (results.length > 0) {
            cards = results.slice(0, 3).map((r): ChatCard => {
              const inLib = !!findBookByTitle(library, r.title);
              const coverUrl = r.coverUrl ?? (r.isbn ? `https://covers.openlibrary.org/b/isbn/${r.isbn}-M.jpg` : undefined);
              return {
                type: "book",
                title: r.title,
                subtitle: r.authors.length > 0 ? `by ${r.authors[0]}` : "",
                coverUrl,
                inLibrary: inLib,
                actions: [],
              };
            });
          }
        } catch { /* non-fatal */ }
      }
    }
  }

  // Persist turns sequentially to preserve order
  await appendTurn(userId, { role: "user", content: message, timestamp: Date.now() });
  await appendTurn(userId, { role: "assistant", content: reply, timestamp: Date.now() });

  // Fire-and-forget auto-save. Skip write intents (they save to dedicated stores).
  // Allow auto-save even when a library pendingAction was proposed — the user's commentary
  // (e.g. "I love the gross medical stuff...") is worth saving regardless of the action.
  const AUTO_SAVE_SKIP = new Set<string>([
    "web_search",       // has its own decideSave flow
    "staples_update",   // saved to Redis pantry
    "recipe_add",       // saved to Redis recipes
    "list_read", "staples_read", "calendar_read", "library_stats",
    "meal_plan_clear",
  ]);
  const isLibraryAction = pendingAction && ["movie_add", "movie_update", "book_add", "book_update"].includes(pendingAction.type);
  if (!AUTO_SAVE_SKIP.has(intent) && (!pendingAction || isLibraryAction)) {
    const dateLabel = new Date().toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric", timeZone: USER_TIMEZONE,
    });
    waitUntil((async () => {
      try {
        await autoSaveExchange(userId, message, reply!, dateLabel);
      } catch { /* non-fatal */ }
    })());
  }

  return NextResponse.json({
    reply,
    intent,
    saved,
    ...(cards ? { cards } : {}),
    ...(pendingAction ? { pendingAction } : {}),
  });
}
