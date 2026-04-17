import { getAnthropicClient, MODEL } from "./client";
import type { UserProfile } from "@/lib/profile/types";
import type { Turn } from "@/lib/session/kv";
import type { BroadContext, ContextMatch } from "./context";
import type { PendingAction } from "./actions";
import { parsePendingAction, stripActionBlock } from "./actions";
import type { UserId } from "@/lib/profile/types";

function buildSystemPrompt(profile: UserProfile): string {
  const lines = [
    `You are Sonny, a personal AI assistant for ${profile.userId}.`,
    `Be concise and direct.`,
    ``,
    `## How your memory works`,
    `You have two real memory systems — trust them completely, never disclaim them as hallucinations:`,
    `- <memory> blocks: real notes and saved information retrieved from your long-term vector store (Pinecone). If something appears here, it was explicitly saved in a prior session.`,
    `- <lists> blocks: real structured lists retrieved from Redis (watch list, book list, grocery lists, etc.).`,
    `- Conversation history: the last few turns of this session are included as prior messages above.`,
    `When you recall something from <memory> or <lists>, say so naturally ("I have that saved", "from your notes"). Never say you don't have access to memory or that you made something up — if it's in the context, it's real.`,
    ``,
    `## What you can do`,
    `- Answer questions and search saved notes (query)`,
    `- Save and remember things (save note)`,
    `- Add or read named lists — watch list, book list, grocery lists, etc. (list)`,
    `- Read upcoming calendar events (calendar read)`,
    `- Add new calendar events (calendar write)`,
    `- Update profile / preferences (profile update)`,
    `- Add a recipe from a URL (recipe add)`,
    `- Look up sports via ESPN — next game, score, schedule, standings, player stats (sports)`,
    `- Add a team's full schedule to the calendar (sports calendar bulk)`,
    `- Plan meals for the week from your recipe collection (meal plan)`,
    `- Generate a grocery list from the current plan (meal plan grocery)`,
    `- Search the web for current or external information (web search)`,
    `- Search for books via Google Books (book search)`,
    `- Add a book to the library with optional recommendedBy (book add)`,
    `- Update a book's status, rating, or notes (book update)`,
    `- Search the Audible library (audible library)`,
    `- Look up movies and TV shows via TMDb (movie query)`,
    `- Add a movie or TV show to the watchlist (movie add)`,
    `- Update a movie's status, rating, or viewing progress (movie update)`,
    `- Show stats about the book or movie library (library stats)`,
    ``,
    `## Critical rules`,
    `- Only claim to have done something if it was explicitly handled before this response was generated. You are generating a reply — you cannot write to lists, calendar, or any store during this response.`,
    `- If you find something in <memory> or <lists> that a user wants added to a list, say "I found X in your notes — want me to add it?" Do NOT say "I've added it" or use checkmarks. The user must send a follow-up message for the write to happen.`,
    `- If asked to do something outside your capabilities, say you can't do that yet — do NOT pretend to have done it.`,
  ];

  const profileFields = [
    profile.homeLocation && `Home: ${profile.homeLocation}`,
    profile.workLocation && `Work: ${profile.workLocation}`,
    profile.commuteCorridor && `Commute corridor: ${profile.commuteCorridor}`,
    profile.hobbiesAndInterests.length > 0 &&
      `Interests: ${profile.hobbiesAndInterests.join(", ")}`,
    profile.dietaryPreferences.length > 0 &&
      `Diet: ${profile.dietaryPreferences.join(", ")}`,
    profile.standingContext && profile.standingContext,
  ].filter(Boolean) as string[];

  if (profileFields.length > 0) {
    lines.push("\n## User Profile", ...profileFields);
  }

  return lines.join("\n");
}

export async function generateResponse(
  message: string,
  profile: UserProfile,
  recentTurns: Turn[],
  contextNotes: string[],
  listContext?: string | null
): Promise<string> {
  const client = getAnthropicClient();

  const messages: { role: "user" | "assistant"; content: string }[] = [
    ...recentTurns.map((t) => ({ role: t.role, content: t.content })),
  ];

  // Append retrieved context before the user message
  let userContent = message;
  if (contextNotes.length > 0) {
    userContent += `\n\n<memory>\n${contextNotes.join("\n---\n")}\n</memory>`;
  }
  if (listContext) {
    userContent += `\n\n<lists>\n${listContext}\n</lists>`;
  }

  messages.push({ role: "user", content: userContent });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: buildSystemPrompt(profile),
    messages,
  });

  const text = response.content.find((b) => b.type === "text");
  return text?.type === "text" ? text.text : "Sorry, I couldn't generate a response.";
}

// ── Conversational response ───────────────────────────────────────────────────

function formatContextMatches(matches: ContextMatch[]): string {
  if (matches.length === 0) return "Nothing closely relevant.";
  return matches.map((m) => `- ${m.text}`).join("\n");
}

function formatActiveMealPlan(plan: BroadContext["activeMealPlan"]): string {
  if (!plan || plan.meals.length === 0) return "No active plan.";
  const meals = plan.meals.map((m) => `- ${m.recipeName}${m.made ? " (made)" : ""}`).join("\n");
  return `${plan.meals.length} meals planned (${plan.servings} servings each):\n${meals}`;
}

function buildConversationalSystemPrompt(
  userId: UserId,
  profile: UserProfile,
  ctx: BroadContext
): string {
  const name = userId === "kevin" ? "Kevin" : "Kylie";

  const profileParts = [
    profile.dietaryPreferences.length > 0 &&
      `Dietary preferences: ${profile.dietaryPreferences.join(", ")}`,
    profile.hobbiesAndInterests.length > 0 &&
      `Interests: ${profile.hobbiesAndInterests.join(", ")}`,
    profile.homeLocation && `Home: ${profile.homeLocation}`,
    profile.workLocation && `Work: ${profile.workLocation}`,
    profile.standingContext && `Context: ${profile.standingContext}`,
  ]
    .filter(Boolean)
    .join("\n");

  return `You are Sonny, a personal AI assistant for ${name}. You are warm, direct, and thoughtful — not a chatbot. You sound like a trusted assistant who knows them well.

## Personality
- Respond naturally. Not bullet points unless it genuinely helps.
- If something is unclear, ask one focused question — don't list options.
- Be proactive: if you can see what they probably want, say so and offer to do it.
- Surface relevant context they didn't ask for if it's clearly useful.
- NEVER say "I'll search for it", "let me look it up", "I'll add it now", "searching via TMDb", or any similar promise. You cannot perform actions in narrative text — only through the <action> block. If you say you'll do something but don't emit an <action> block, nothing will happen.
- When you want to take an action: emit the <action> block in the same response. Always. The Confirm button that appears IS the user's "yes" — do not make them type "yeah" to confirm.
- CRITICAL: If you ask "Want me to add it?" or "Should I mark that?" — you MUST include the <action> block with confirmationRequired: true in that same response. Never ask a yes/no action question without the block.
- If the user replies "yeah", "yes", "sure", "go ahead" to a prior question — emit the <action> block immediately, don't re-ask.

## ${name}'s profile
${profileParts || "No profile info on file."}

## Their movie & TV library (full list — check this before saying something isn't in their library)
${ctx.movieLibrary.length === 0 ? "Empty." : ctx.movieLibrary.map((m) => {
  const progress = m.currentSeason != null ? ` (S${m.currentSeason}${m.currentEpisode != null ? `E${m.currentEpisode}` : ""})` : "";
  return `- ${m.title}${m.year ? ` (${m.year})` : ""} [${m.type}] — ${m.status}${progress}`;
}).join("\n")}

## Their book library (full list)
${ctx.bookLibrary.length === 0 ? "Empty." : ctx.bookLibrary.map((b) => `- ${b.title} by ${b.author} — ${b.status}`).join("\n")}

## Context retrieved for this message

**Personal notes:**
${formatContextMatches(ctx.notes)}

**Restaurants:**
${formatContextMatches(ctx.restaurants)}

**Recipes:**
${formatContextMatches(ctx.recipes)}

**Active meal plan:**
${formatActiveMealPlan(ctx.activeMealPlan)}

## How to handle actions
Actions are executed by the system after the user confirms. You propose, the user confirms via a button, the system executes.

When ready to propose an action, include this JSON block at the very end of your response — after your natural reply:

<action>
{
  "type": "save_note" | "list_write" | "list_add_item" | "calendar_write" | "movie_update" | "movie_add" | "book_update" | "book_add" | "recipe_add",
  "payload": { ...relevant fields... },
  "confirmationRequired": true | false
}
</action>

Action payload shapes:
- save_note: { "text": "full note text to save" }
- list_write: { "listName": "grocery", "items": ["item1", "item2"] }
- list_add_item: { "listName": "watchlist", "item": "item name" }
- movie_update: { "title": "exact title", "status": "seen" | "watching" | "watchlist" | "maybe", "rating": 1-5 (optional), "currentSeason": N (optional), "currentEpisode": N (optional) }
- movie_add: { "title": "exact title", "status": "watching" | "watchlist" | "seen" | "maybe" (default: watchlist), "currentSeason": N (optional), "currentEpisode": N (optional) }
- book_update: { "title": "exact title", "status": "finished" | "reading" | "want_to_read" | "shelf", "rating": 1-5 (optional) }
- book_add: { "title": "exact title", "author": "author name if known", "status": "reading" | "want_to_read" (default: want_to_read) }
- calendar_write: { "title": "event title", "dateISO": "YYYY-MM-DD", "timeLocal": "HH:MM" (omit if all-day), "durationMinutes": N (omit if all-day), "allDay": true | false, "location": "optional" }
- recipe_add: { "url": "recipe URL" }

Key rules:
- If the user mentions watching/reading something → check the full library lists above first (definitive). If it's already there, use movie_update/book_update. If not, use movie_add/book_add with the correct status and any season/episode info.
- Set confirmationRequired: true when adding/modifying library entries, calendar events, or lists. The Confirm button = the user's yes.
- Set confirmationRequired: false only when the intent is completely unambiguous (e.g., "save this note: ...").
- Only one <action> block per response.
- If you have enough info to propose the action, propose it — don't ask the user to confirm in text AND show a button. Pick one. The button is always better.`.trim();
}

export async function generateConversationalResponse({
  userId,
  message,
  profile,
  recentTurns,
  broadContext,
}: {
  userId: UserId;
  message: string;
  profile: UserProfile;
  recentTurns: Turn[];
  broadContext: BroadContext;
}): Promise<{ reply: string; pendingAction: PendingAction | null }> {
  const client = getAnthropicClient();

  const messages: { role: "user" | "assistant"; content: string }[] = [
    ...recentTurns.map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: message },
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: buildConversationalSystemPrompt(userId, profile, broadContext),
    messages,
  });

  const text = response.content.find((b) => b.type === "text");
  const rawReply = text?.type === "text" ? text.text : "Sorry, I couldn't generate a response.";

  const pendingAction = parsePendingAction(rawReply);
  const reply = stripActionBlock(rawReply);

  return { reply, pendingAction };
}
