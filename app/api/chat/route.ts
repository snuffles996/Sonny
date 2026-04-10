// POST /api/chat
// Body: { message: string }
// Header: Authorization: Bearer <KEVIN_SECRET or KYLIE_SECRET>

import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getProfile } from "@/lib/profile/store";
import { classifyIntent } from "@/lib/anthropic/classify";
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
import { getActivePlan, saveActivePlan, clearActivePlan } from "@/lib/mealplan/store";
import { selectMeals } from "@/lib/mealplan/select";
import { identifySwapTarget } from "@/lib/anthropic/mealplan";
import { getRecipes, setRecipes } from "@/lib/recipes/store";
import { buildGroceryList, formatGroceryListText } from "@/lib/mealplan/grocery";
import type { MealPlan, PlannedMeal } from "@/lib/mealplan/types";

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

  // Load profile, session turns, intent classification, and context search all in parallel
  const [profile, recentTurns, intent, contextNotes] = await Promise.all([
    getProfile(userId),
    getRecentTurns(userId),
    classifyIntent(message),
    searchNotes(userId, message), // run speculatively — used if intent is query
  ]);

  let reply: string;
  let saved = false;

  switch (intent) {
    case "save_note": {
      await saveNote(userId, message);
      saved = true;
      reply = "Got it, saved to your memory.";
      break;
    }
    case "query": {
      reply = await generateResponse(message, profile, recentTurns, contextNotes);
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
            const gameNote = sportsResult?.game
              ? ` (game time from ESPN: ${sportsResult.game.startTimeUTC})`
              : "";
            reply = `Done — "${details.title}" has been added to your calendar.${gameNote}`;
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
        groceryListSent: false,
      };
      await saveActivePlan(newPlan);

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
      reply = `Swapped **${oldName}** for **${newMeal.recipe.name}**. ${newMeal.reason}`;
      break;
    }
    case "meal_plan_grocery": {
      const groceryPlan = await getActivePlan();
      if (!groceryPlan || groceryPlan.meals.length === 0) {
        reply = "There's no active meal plan to build a grocery list from. Want me to plan some meals first?";
        break;
      }
      const groceryRecipes = await getRecipes();
      const groceryItems = await buildGroceryList(groceryPlan.meals, groceryRecipes, groceryPlan.servings);
      if (groceryItems.length === 0) {
        reply = "I couldn't parse ingredients from the current plan's recipes. The recipes may be missing an Ingredients section.";
        break;
      }
      // Mark grocery list as sent and update the plan
      groceryPlan.groceryListSent = true;
      groceryPlan.updatedAt = new Date().toISOString();
      groceryPlan.updatedBy = userId;
      await saveActivePlan(groceryPlan);

      const listText = formatGroceryListText(groceryItems);
      reply = `Here's your grocery list for ${groceryPlan.meals.length} meal${groceryPlan.meals.length !== 1 ? "s" : ""} (${groceryPlan.servings} servings each):\n\n${listText}\n\nSay "send to Reminders" to push this to your iCloud Reminders list.`;
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
    default: {
      reply = await generateResponse(message, profile, recentTurns, contextNotes);
    }
  }

  // Persist turns sequentially to preserve order
  await appendTurn(userId, { role: "user", content: message, timestamp: Date.now() });
  await appendTurn(userId, { role: "assistant", content: reply, timestamp: Date.now() });

  return NextResponse.json({ reply, intent, saved });
}
