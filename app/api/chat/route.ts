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
import { getUpcomingEvents, createEvent, USER_TIMEZONE } from "@/lib/caldav/events";
import { extractEventDetails } from "@/lib/anthropic/calendar";
import { isCalDAVConfigured } from "@/lib/caldav/client";
import { extractRecipeFromUrl, extractUrlFromMessage } from "@/lib/recipes/extract";
import { addRecipe } from "@/lib/recipes/store";
import { detectTeam, findGame } from "@/lib/sports/lookup";

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
          const events = await getUpcomingEvents();
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
    default: {
      reply = await generateResponse(message, profile, recentTurns, contextNotes);
    }
  }

  // Persist turns sequentially to preserve order
  await appendTurn(userId, { role: "user", content: message, timestamp: Date.now() });
  await appendTurn(userId, { role: "assistant", content: reply, timestamp: Date.now() });

  return NextResponse.json({ reply, intent, saved });
}
