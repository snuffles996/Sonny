// POST /api/chat
// Body: { message: string }
// Header: Authorization: Bearer <KEVIN_SECRET or SARAH_SECRET>

import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getProfile } from "@/lib/profile/store";
import { classifyIntent } from "@/lib/anthropic/classify";
import { generateResponse } from "@/lib/anthropic/respond";
import { getRecentTurns, appendTurn } from "@/lib/session/kv";
import { saveNote, searchNotes } from "@/lib/pinecone/records";

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

  // Load profile and session context in parallel
  const [profile, recentTurns] = await Promise.all([
    getProfile(userId),
    getRecentTurns(userId),
  ]);

  // Classify intent and route
  const intent = await classifyIntent(message);

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
      const contextNotes = await searchNotes(userId, message);
      reply = await generateResponse(message, profile, recentTurns, contextNotes);
      break;
    }
    case "calendar_read":
    case "calendar_write": {
      reply = "Calendar integration coming soon.";
      break;
    }
    case "profile_update": {
      reply = "Profile updates coming soon.";
      break;
    }
    default: {
      const contextNotes = await searchNotes(userId, message);
      reply = await generateResponse(message, profile, recentTurns, contextNotes);
    }
  }

  // Persist turns sequentially to preserve order
  await appendTurn(userId, { role: "user", content: message, timestamp: Date.now() });
  await appendTurn(userId, { role: "assistant", content: reply, timestamp: Date.now() });

  return NextResponse.json({ reply, intent, saved });
}
