import { getAnthropicClient, FAST_MODEL } from "./client";

export type Intent =
  | "save_note"
  | "query"
  | "web_search"
  | "calendar_read"
  | "calendar_write"
  | "profile_update"
  | "recipe_add"
  | "sports_query"
  | "sports_score"
  | "sports_schedule"
  | "sports_standings"
  | "sports_player_stats"
  | "sports_calendar_bulk"
  | "meal_plan_create"
  | "meal_plan_swap"
  | "meal_plan_grocery"
  | "meal_plan_clear"
  | "book_search"
  | "audible_library"
  | "movie_query";

const INTENT_DESCRIPTIONS = [
  "save_note: user wants to save, remember, or log something personal to their memory",
  "query: user is asking about something stored in their personal notes or memory (what they've saved, what they've logged, etc.)",
  "web_search: user is asking about something in the external world — current events, general knowledge, restaurants or places, health topics, product research, how-to questions, or anything not stored in personal notes",
  "book_search: user wants to discover or find out about a book, novel, or audiobook — 'find a book about X', 'what should I read next', 'my friend recommended a book'",
  "audible_library: user is asking about a book they already own in their Audible library — 'that book I have about...', 'find in my audible', 'books I've bought'",
  "movie_query: user is asking about a movie, TV show, or series — 'what's that movie where...', 'who's in X', 'is X on Netflix', 'recommend a show'",
  "calendar_read: user wants to see upcoming events or check their schedule",
  "calendar_write: user wants to add, change, or remove a calendar event",
  "profile_update: user wants to update their personal preferences or profile info",
  "recipe_add: user wants to add or save a recipe, often by providing a URL or link",
  "sports_query: user is asking about a sports team's next single game or game time — without requesting a calendar event",
  "sports_score: user is asking about a game's score, result, or whether a team won or lost",
  "sports_schedule: user wants to see a team's upcoming schedule or next several games (more than one)",
  "sports_standings: user is asking about league or division standings, rankings, or what place a team is in",
  "sports_player_stats: user is asking about a specific player's stats, performance, or season numbers",
  "sports_calendar_bulk: user wants to add multiple games or a team's full schedule to their calendar",
  "meal_plan_create: user wants to plan meals, get dinner suggestions, or start a meal plan for the week",
  "meal_plan_swap: user wants to replace or swap a specific meal in the current plan",
  "meal_plan_grocery: user wants a grocery list, shopping list, or to know what ingredients to buy for their meals",
  "meal_plan_clear: user wants to clear, reset, or start over with the meal plan",
].join("\n");

export async function classifyIntent(message: string): Promise<Intent> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: FAST_MODEL,
    max_tokens: 64,
    system: `Classify the user's message into exactly one intent.\n\nIntents:\n${INTENT_DESCRIPTIONS}`,
    messages: [{ role: "user", content: message }],
    tools: [
      {
        name: "classify_intent",
        description: "Return the intent of the user message",
        input_schema: {
          type: "object" as const,
          properties: {
            intent: {
              type: "string",
              enum: [
                "save_note",
                "query",
                "calendar_read",
                "calendar_write",
                "profile_update",
                "recipe_add",
                "sports_query",
                "sports_score",
                "sports_schedule",
                "sports_standings",
                "sports_player_stats",
                "sports_calendar_bulk",
                "meal_plan_create",
                "meal_plan_swap",
                "meal_plan_grocery",
                "meal_plan_clear",
                "book_search",
                "audible_library",
                "movie_query",
                "web_search",
              ],
            },
          },
          required: ["intent"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "classify_intent" },
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return "query";
  return (toolUse.input as { intent: Intent }).intent;
}
