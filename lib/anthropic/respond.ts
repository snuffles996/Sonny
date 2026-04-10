import { getAnthropicClient, MODEL } from "./client";
import type { UserProfile } from "@/lib/profile/types";
import type { Turn } from "@/lib/session/kv";

function buildSystemPrompt(profile: UserProfile): string {
  const lines = [
    `You are Sonny, a personal AI assistant for ${profile.userId}.`,
    `Be concise and direct. You have access to the user's saved notes and conversation history.`,
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
