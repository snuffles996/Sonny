import { getAnthropicClient, FAST_MODEL } from "./client";
import { USER_TIMEZONE } from "@/lib/caldav/events";
import type { NewEventDetails } from "@/lib/caldav/events";

export async function extractEventDetails(
  message: string
): Promise<NewEventDetails | null> {
  const client = getAnthropicClient();

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: USER_TIMEZONE,
  });

  const response = await client.messages.create({
    model: FAST_MODEL,
    max_tokens: 256,
    system: `Extract calendar event details from the user's message.
Today is ${today}. The user is in the ${USER_TIMEZONE} timezone.
Format dates as YYYYMMDDTHHMMSS for timed events, or YYYYMMDD for all-day events.
Default duration is 1 hour unless specified. If no time is mentioned, assume all-day.`,
    messages: [{ role: "user", content: message }],
    tools: [
      {
        name: "create_event",
        description: "Create a new calendar event with the extracted details",
        input_schema: {
          type: "object" as const,
          properties: {
            title: { type: "string", description: "Event title" },
            startLocal: {
              type: "string",
              description: "Start as YYYYMMDDTHHMMSS (timed) or YYYYMMDD (all-day)",
            },
            endLocal: {
              type: "string",
              description: "End as YYYYMMDDTHHMMSS (timed) or YYYYMMDD (all-day)",
            },
            allDay: { type: "boolean" },
            location: { type: "string" },
            notes: { type: "string" },
          },
          required: ["title", "startLocal", "endLocal", "allDay"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "create_event" },
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return null;

  const input = toolUse.input as Omit<NewEventDetails, "timezone">;
  return { ...input, timezone: USER_TIMEZONE };
}
