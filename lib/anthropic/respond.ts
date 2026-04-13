import { getAnthropicClient, MODEL } from "./client";
import type { UserProfile } from "@/lib/profile/types";
import type { Turn } from "@/lib/session/kv";

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
    `- Search the Audible library (audible library)`,
    `- Look up movies and TV shows via TMDb (movie query)`,
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
