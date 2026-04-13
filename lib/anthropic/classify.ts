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
  | "movie_query"
  | "list_write"
  | "list_read"
  | "categorization_correction"
  | "staples_update"
  | "staples_read";

export interface ClassificationResult {
  intent: Intent;
  listName?: string;
  items?: string[];
  staplesAction?: "add" | "remove";
  staplesItems?: string[];
  correctionItem?: string;
  correctionCategory?: string;
}

const INTENT_DESCRIPTIONS = [
  "save_note: user wants to save, remember, or log something personal to their memory",
  "query: user is asking about something stored in their personal notes or memory (what they've saved, what they've logged, etc.)",
  "web_search: user is asking about something in the external world — current events, general knowledge, restaurants or places, health topics, product research, how-to questions, or anything not stored in personal notes",
  "book_search: user wants to discover or find out about a book, novel, or audiobook — 'find a book about X', 'what should I read next', 'my friend recommended a book'",
  "audible_library: user is asking about a book they already own in their Audible library — 'that book I have about...', 'find in my audible', 'books I've bought'",
  "movie_query: user is asking about or looking up a movie, TV show, or series — 'what's that movie where...', 'who's in X', 'is X on Netflix', 'recommend a show', 'tell me about X'. NOT triggered by 'I want to watch X' or 'add X to my watch list' — those are list_write.",
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
  "list_write: user wants to add one or more discrete items to a named list. Triggered by: 'add X to my Y list', 'put X on the Costco list', 'I need to grab X', 'I want to watch X' (listName=watchlist), 'I want to read X' (listName=books), store names (Costco, Target, Trader Joe's, etc.) combined with item nouns. NOT a note. NOT a recipe. Individual buyable or doable items. List intents take priority over save_note, movie_query, or book_search when the intent is to save/remember something for later.",
  "list_read: user wants to see a list or find out what lists exist. Triggered by: 'what's on my X list', 'read me my Costco list', 'show me my grocery list', 'what lists do I have', 'what are my lists', 'show all my lists'. When asking about a SPECIFIC list, set listName. When asking what lists exist (no specific list named), omit listName entirely. NOT triggered by questions about saved notes or memory.",
  "categorization_correction: user is correcting where an item was categorized. Triggered by: 'X should be in Y', 'X doesn't belong in Y', 'move X to Y', 'X goes in Y not Z'. Extract the item name and the correct category.",
  "staples_update: user wants to add or remove items from the shared pantry staples list. Triggered by: 'add X to my staples', 'move X to pantry staples', 'X should be a staple', 'add to pantry staples', 'items to move to pantry staples', 'I always have X', 'X is always in my pantry', 'remove X from staples', 'I'm out of X' (when X is a pantry item). IMPORTANT: if the message contains a section headed 'items to move to pantry staples' or 'add to staples' followed by a list, classify as staples_update and extract ALL listed items. Extract action (add or remove) and items.",
  "staples_read: user wants to see the pantry staples list. Triggered by: 'what are my staples', 'show me my pantry staples', 'what do I always have'.",
].join("\n");

export async function classifyIntent(message: string): Promise<ClassificationResult> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: FAST_MODEL,
    max_tokens: 256,
    system: `Classify the user's message into exactly one intent.\n\nIntents:\n${INTENT_DESCRIPTIONS}`,
    messages: [{ role: "user", content: message }],
    tools: [
      {
        name: "classify_intent",
        description: "Return the intent of the user message and any associated data",
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
                "list_write",
                "list_read",
                "categorization_correction",
                "staples_update",
                "staples_read",
              ],
            },
            listName: {
              type: "string",
              description: "Normalized lowercase list name for a SPECIFIC list. Map store names to canonical form: 'costco run' → 'costco', 'grocery list' → 'grocery', 'trader joes' → 'traderjoes'. Always lowercase, no spaces. OMIT this field when the user is asking what lists exist (e.g. 'what lists do I have', 'what are my lists') — do not set it to 'all' or any other value.",
            },
            items: {
              type: "array",
              items: { type: "string" },
              description: "Individual items to add for list_write. Each item should be a clean noun phrase: 'paper towels', 'olive oil'.",
            },
            staplesAction: {
              type: "string",
              enum: ["add", "remove"],
              description: "Whether to add or remove from pantry staples. Only for staples_update.",
            },
            staplesItems: {
              type: "array",
              items: { type: "string" },
              description: "Items to add or remove from pantry staples. Only for staples_update.",
            },
            correctionItem: {
              type: "string",
              description: "The item being recategorized. Only for categorization_correction.",
            },
            correctionCategory: {
              type: "string",
              description: "The correct category for the item. Only for categorization_correction.",
            },
          },
          required: ["intent"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "classify_intent" },
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return { intent: "query" };
  return toolUse.input as ClassificationResult;
}
