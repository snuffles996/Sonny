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
When you want to take an action (add/update a movie or book, save a note, add to a list, create a calendar event), call the propose_action tool. You can respond conversationally AND call the tool in the same turn. The system will show the user a Confirm button — that button is their "yes". Do not ask them to say yes in text AND show a button.

Key rules:
- If the user mentions watching/reading something → check the library lists above first. If it's already there, call propose_action with movie_update/book_update. If not, call propose_action with movie_add/book_add including status and any episode/season info.
- Always call propose_action rather than narrating what you're going to do. "I'll add it" with no tool call = nothing happens.
- Use confirmationRequired: true for library changes, calendar events, list writes. Use false only for unambiguous explicit saves ("remember that...").
- If you genuinely need one clarifying detail, ask — but if you have enough info, just call the tool.`.trim();
}

const PROPOSE_ACTION_TOOL = {
  name: "propose_action",
  description: "Propose an action to take on the user's behalf. The system will show a Confirm button — use this instead of narrating what you're about to do.",
  input_schema: {
    type: "object" as const,
    properties: {
      type: {
        type: "string",
        enum: ["save_note", "list_write", "list_add_item", "calendar_write", "movie_update", "movie_add", "book_update", "book_add", "recipe_add"],
      },
      payload: {
        type: "object",
        description: "Action-specific fields. movie_add: {title, status?, currentSeason?, currentEpisode?}. movie_update: {title, status?, rating?, currentSeason?, currentEpisode?}. book_add: {title, author?, status?}. book_update: {title, status?, rating?}. save_note: {text}. list_write: {listName, items[]}. list_add_item: {listName, item}. calendar_write: {title, dateISO, timeLocal?, durationMinutes?, allDay, location?}. recipe_add: {url}.",
        additionalProperties: true,
      },
      confirmationRequired: {
        type: "boolean",
        description: "true for library changes, calendar events, list writes. false only for unambiguous explicit saves.",
      },
    },
    required: ["type", "payload", "confirmationRequired"] as string[],
  },
} as const;

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
    tools: [PROPOSE_ACTION_TOOL],
    tool_choice: { type: "auto" },
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const toolBlock = response.content.find((b) => b.type === "tool_use" && b.name === "propose_action");

  const reply = textBlock?.type === "text" ? stripActionBlock(textBlock.text) : "Got it.";
  const pendingAction = toolBlock?.type === "tool_use"
    ? (toolBlock.input as PendingAction)
    : parsePendingAction(reply); // fallback: still parse <action> blocks if Claude used old format

  return { reply, pendingAction };
}
