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
  | "book_add"
  | "book_update"
  | "audible_library"
  | "movie_query"
  | "movie_add"
  | "movie_update"
  | "library_stats"
  | "list_write"
  | "list_read"
  | "categorization_correction"
  | "staples_update"
  | "staples_read"
  | "conversational";

export interface ClassificationResult {
  intent: Intent;
  confidence: "high" | "low";
  listName?: string;
  items?: string[];
  bookTitles?: string[];
  movieTitles?: string[];
  staplesAction?: "add" | "remove";
  staplesItems?: string[];
  correctionItem?: string;
  correctionCategory?: string;
}

const INTENT_DESCRIPTIONS = [
  "conversational: user is asking a question, making a comment, or expressing something ambiguous — anything involving fuzzy references to a title, 'what should I watch/read', describing a mood or genre preference, finishing/watching/reading something (may need to update library), or anything that requires reasoning from context. Use this when unsure.",
  "save_note: user wants to save, remember, or log something personal to their memory",
  "query: user is asking about something stored in their personal notes, memory, or lists — including semantic questions about list contents like 'was there a movie about X on my list', 'do I have any shows about Y', 'which of my saved items is about Z'.",
  "web_search: user is asking about something in the external world — current events, general knowledge, restaurants or places, health topics, product research, how-to questions, or anything not stored in personal notes",
  "book_search: user wants to discover or find out about a book, novel, or audiobook — 'find a book about X', 'what should I read next', 'recommend a book'. Does NOT save anything.",
  "book_add: user wants to save a book to their library — 'I want to read X', 'add X by Y to my library', 'save this book', 'recommended by Z, add it'. Saves to the book library with optional recommendedBy.",
  "book_update: user wants to update a book already in their library — 'I finished X', 'I'm reading X', 'rate X 4 stars', 'mark X as read', 'add a note to X'.",
  "audible_library: user is asking about a book they already own in their Audible library — 'that book I have about...', 'find in my audible', 'books I've bought'",
  "movie_query: user is asking about or looking up a movie, TV show, or series — 'what's that movie where...', 'who's in X', 'is X on Netflix', 'recommend a show', 'tell me about X'. Does NOT save anything.",
  "movie_add: user wants to add a movie or TV show to their library — 'add X to my watchlist', 'I want to watch X', 'save X for later', 'put X on my watch list'. Saves to the movie library.",
  "movie_update: user wants to update a movie or show already in their library — 'I watched X', 'watching Severance season 2 episode 4', 'rate X 5 stars', 'mark X as seen'.",
  "library_stats: user is asking about statistics or counts from their book or movie library — 'how many books have I read', 'what's in my watchlist', 'how many movies have I seen'.",
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
  "list_write: user wants to add one or more discrete items to a named list — grocery lists, to-do lists, etc. Triggered by: 'add X to my Y list', 'put X on the Costco list', 'I need to grab X', store names (Costco, Target, Trader Joe's, etc.) combined with item nouns. NOT a note. NOT a recipe. NOT movies or books (those are movie_add and book_add). Individual buyable or doable items.",
  "list_read: user wants the full contents of a list displayed. Triggered by ONLY: 'what's on my X list', 'show me my X list', 'read me my X list', 'what lists do I have'. NOT triggered by semantic questions about list contents like 'was there a X on my list', 'do I have any Y on my list', 'which of my shows is about Z' — those are query intent. When asking about a SPECIFIC list, set listName. When asking what lists exist, omit listName.",
  "categorization_correction: user is correcting where an item was categorized. Triggered by: 'X should be in Y', 'X doesn't belong in Y', 'move X to Y', 'X goes in Y not Z'. Extract the item name and the correct category.",
  "staples_update: user wants to add or remove items from the shared pantry staples list. Triggered by: 'add X to my staples', 'move X to pantry staples', 'X should be a staple', 'add to pantry staples', 'items to move to pantry staples', 'I always have X', 'X is always in my pantry', 'remove X from staples', 'I'm out of X' (when X is a pantry item). IMPORTANT: if the message contains a section headed 'items to move to pantry staples' or 'add to staples' followed by a list, classify as staples_update and extract ALL listed items. Extract action (add or remove) and items.",
  "staples_read: user wants to see the pantry staples list. Triggered by: 'what are my staples', 'show me my pantry staples', 'what do I always have'.",
].join("\n");

export async function classifyIntent(message: string): Promise<ClassificationResult> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: FAST_MODEL,
    max_tokens: 256,
    system: [
      `Classify the user's message into exactly one intent and set confidence.`,
      ``,
      `Set confidence: "high" only for unambiguous structural commands:`,
      `- Clear sports requests (score, schedule, standings, calendar bulk)`,
      `- Clear meal plan commands (create, swap, grocery, clear)`,
      `- Staples updates/reads, profile updates, calendar reads`,
      `- Explicit list reads ("show me my X list"), categorization corrections`,
      `- Web searches, recipe URL adds, Audible library lookups`,
      `- Library stats requests`,
      ``,
      `Set confidence: "low" and intent: "conversational" for:`,
      `- Any fuzzy reference to a movie/book/show title`,
      `- "What should I watch/read", mood/genre preferences`,
      `- Finishing, watching, or reading something (may need library update)`,
      `- Questions or anything involving reasoning from context`,
      `- Ambiguous requests or follow-up questions`,
      `- General conversation, opinions, or anything unclear`,
      ``,
      `Intents:\n${INTENT_DESCRIPTIONS}`,
    ].join("\n"),
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
                "conversational",
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
                "book_add",
                "book_update",
                "audible_library",
                "movie_query",
                "movie_add",
                "movie_update",
                "library_stats",
                "web_search",
                "list_write",
                "list_read",
                "categorization_correction",
                "staples_update",
                "staples_read",
              ],
            },
            confidence: {
              type: "string",
              enum: ["high", "low"],
              description: "high = unambiguous structural command; low = conversational, fuzzy, or unclear",
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
            bookTitles: {
              type: "array",
              items: { type: "string" },
              description: "Individual book titles for book_add or book_update. Extract each title as a clean string: 'Project Hail Mary', 'Atomic Habits'. One element per title.",
            },
            movieTitles: {
              type: "array",
              items: { type: "string" },
              description: "Individual movie or TV show titles for movie_add or movie_update. Extract each as a clean string: 'Severance', 'Oppenheimer'. One element per title.",
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
          required: ["intent", "confidence"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "classify_intent" },
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return { intent: "conversational", confidence: "low" };
  return toolUse.input as ClassificationResult;
}
