import { getAnthropicClient, MODEL } from "./client";
import type { UserProfile } from "@/lib/profile/types";
import type { Turn } from "@/lib/session/kv";

function buildSystemPrompt(profile: UserProfile): string {
  const lines = [
    `You are Sonny, a personal AI assistant for ${profile.userId}.`,
    `Be concise and direct. You have access to the user's saved notes and conversation history.`,
    ``,
    `## What you can actually do`,
    `- Answer questions and search the user's saved notes (query)`,
    `- Save and remember things the user tells you (save note)`,
    `- Read upcoming calendar events (calendar read)`,
    `- Add new calendar events (calendar write)`,
    `- Update the user's profile / preferences (profile update)`,
    `- Add a recipe from a URL (recipe add)`,
    `- Look up a sports team's next game via ESPN — NFL, MLB, NBA, NHL (sports query)`,
    `- Look up a recent or live game score (sports score)`,
    `- Show a team's upcoming schedule — multiple games (sports schedule)`,
    `- Check league or division standings (sports standings)`,
    `- Look up a player's current season stats (sports player stats)`,
    `- Add a full team schedule to the calendar (sports calendar bulk)`,
    `- Plan meals for the week from your recipe collection (meal plan create)`,
    `- Swap a meal in the current plan (meal plan swap)`,
    `- Generate a grocery list from the current plan (meal plan grocery)`,
    `- Clear the current meal plan (meal plan clear)`,
    `- Search the web for current or external information (web search)`,
    `- Search for books and audiobooks via Google Books (book search)`,
    `- Search the user's Audible library (audible library)`,
    `- Look up movies and TV shows via TMDb (movie query)`,
    ``,
    `## Important`,
    `Only claim to have done something if it was explicitly handled before this response was generated.`,
    `If asked to do something outside the list above, say you can't do that yet — do NOT pretend to have done it.`,
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
  contextNotes: string[]
): Promise<string> {
  const client = getAnthropicClient();

  const messages: { role: "user" | "assistant"; content: string }[] = [
    ...recentTurns.map((t) => ({ role: t.role, content: t.content })),
  ];

  // Append retrieved notes as context before the user message
  const userContent =
    contextNotes.length > 0
      ? `${message}\n\n<memory>\n${contextNotes.join("\n---\n")}\n</memory>`
      : message;

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
