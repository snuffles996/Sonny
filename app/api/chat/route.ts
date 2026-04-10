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
import { getUpcomingEvents, createEvent } from "@/lib/caldav/events";
import { extractEventDetails } from "@/lib/anthropic/calendar";
import { isCalDAVConfigured } from "@/lib/caldav/client";

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
        const events = await getUpcomingEvents();
        reply = await generateResponse(message, profile, recentTurns, [events]);
      }
      break;
    }
    case "calendar_write": {
      if (!isCalDAVConfigured()) {
        reply = "Calendar isn't connected yet — add CALDAV_USERNAME and CALDAV_PASSWORD to get started.";
      } else {
        const details = await extractEventDetails(message);
        if (!details) {
          reply = "I wasn't sure what event to create — could you give me more details?";
        } else {
          await createEvent(details);
          reply = `Done — "${details.title}" has been added to your calendar.`;
        }
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
    default: {
      reply = await generateResponse(message, profile, recentTurns, contextNotes);
    }
  }

  // Persist turns sequentially to preserve order
  await appendTurn(userId, { role: "user", content: message, timestamp: Date.now() });
  await appendTurn(userId, { role: "assistant", content: reply, timestamp: Date.now() });

  return NextResponse.json({ reply, intent, saved });
}
