import { getAnthropicClient, FAST_MODEL } from "./client";
import type { UserProfile } from "@/lib/profile/types";

type ProfileUpdates = Partial<Omit<UserProfile, "userId" | "updatedAt">>;

export async function extractProfileUpdate(
  message: string,
  currentProfile: UserProfile
): Promise<ProfileUpdates> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: FAST_MODEL,
    max_tokens: 256,
    system: `Extract profile field updates from the user's message. Only include fields that are being changed.
For array fields (hobbiesAndInterests, dietaryPreferences), return the complete new array — including existing items you are keeping.

Current profile:
${JSON.stringify(currentProfile, null, 2)}`,
    messages: [{ role: "user", content: message }],
    tools: [
      {
        name: "update_profile",
        description: "Update one or more fields in the user's profile",
        input_schema: {
          type: "object" as const,
          properties: {
            homeLocation: { type: "string" },
            workLocation: { type: "string" },
            commuteCorridor: { type: "string" },
            hobbiesAndInterests: {
              type: "array",
              items: { type: "string" },
              description: "Complete updated list of hobbies and interests",
            },
            dietaryPreferences: {
              type: "array",
              items: { type: "string" },
              description: "Complete updated list of dietary preferences/restrictions",
            },
            standingContext: { type: "string" },
          },
        },
      },
    ],
    tool_choice: { type: "tool", name: "update_profile" },
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return {};
  return toolUse.input as ProfileUpdates;
}
