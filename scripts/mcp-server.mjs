#!/usr/bin/env node
/**
 * Sonny MCP stdio server — wraps the Sonny REST API for Claude Desktop.
 *
 * Required env vars (set in Claude Desktop config):
 *   SONNY_BASE_URL  — e.g. https://sonny-snuffles996s-projects.vercel.app
 *   SONNY_TOKEN     — your KEVIN_SECRET or KYLIE_SECRET value
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BASE_URL = (process.env.SONNY_BASE_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.SONNY_TOKEN;

if (!BASE_URL || !TOKEN) {
  process.stderr.write("SONNY_BASE_URL and SONNY_TOKEN must be set\n");
  process.exit(1);
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  // ── Meal planning ───────────────────────────────────────────────────────────
  {
    name: "get_meal_plan",
    description: "Return the current active meal plan, including all planned meals and serving count.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_meal_plan",
    description: "Run Sonnet meal selection and save a new active plan. Respects dietary preferences from the user's profile.",
    inputSchema: {
      type: "object",
      properties: {
        count: { type: "number", description: "Number of meals to plan (default 4, max 7)." },
        preferences: { type: "string", description: "Optional flavour hint (e.g. 'something light this week')." },
      },
    },
  },
  {
    name: "clear_meal_plan",
    description: "Clear the active meal plan and grocery list.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "swap_meal",
    description: "Swap one meal in the active plan. Provide targetSlug (the recipeSlug to replace) OR a natural-language message like 'swap the pasta'.",
    inputSchema: {
      type: "object",
      properties: {
        targetSlug: { type: "string", description: "The recipeSlug to replace." },
        message: { type: "string", description: "Natural-language swap request (used when targetSlug is not provided)." },
        preferences: { type: "string", description: "Optional flavour hint for the replacement." },
      },
    },
  },
  {
    name: "get_grocery_list",
    description: "Return the grocery list for the active meal plan, grouped by category. Builds and caches automatically.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "rebuild_grocery_list",
    description: "Force-rebuild the grocery list from the current active plan, ignoring any cached version.",
    inputSchema: { type: "object", properties: {} },
  },
  // ── Notes ───────────────────────────────────────────────────────────────────
  {
    name: "search_notes",
    description: "Semantic search over your Sonny notes (Pinecone). Returns the most relevant stored notes.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query." },
        topK: { type: "number", description: "Max results (default 5)." },
      },
      required: ["query"],
    },
  },
  {
    name: "save_note",
    description: "Save a note to Sonny memory (Pinecone). Prefix with today's date for temporal recall, e.g. 'April 17, 2026: ...'.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The note text to store." },
      },
      required: ["text"],
    },
  },
  // ── Recipes ─────────────────────────────────────────────────────────────────
  {
    name: "add_recipe",
    description: "Fetch a recipe page by URL, extract structured data via Haiku, and save it to the recipe library.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Full URL of the recipe page." },
      },
      required: ["url"],
    },
  },
  {
    name: "list_recipes",
    description: "Return all recipes in the library as a JSON array.",
    inputSchema: { type: "object", properties: {} },
  },
  // ── Calendar ────────────────────────────────────────────────────────────────
  {
    name: "get_upcoming_events",
    description: "Return upcoming iCloud calendar events.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Days ahead to fetch (default 7, max 30)." },
      },
    },
  },
  {
    name: "create_calendar_event",
    description: "Create an event in iCloud. startLocal/endLocal format: YYYYMMDDTHHMMSS (timed) or YYYYMMDD (all-day).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        startLocal: { type: "string", description: "e.g. 20260420T190000" },
        endLocal: { type: "string", description: "e.g. 20260420T210000" },
        allDay: { type: "boolean" },
        timezone: { type: "string", description: "IANA timezone (default America/Los_Angeles)." },
        location: { type: "string" },
        notes: { type: "string" },
      },
      required: ["title", "startLocal", "endLocal"],
    },
  },
  // ── Pantry ──────────────────────────────────────────────────────────────────
  {
    name: "get_pantry",
    description: "Return the shared pantry staples list. These items are excluded from grocery lists.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "update_pantry",
    description: "Add or remove items from the shared pantry staples list.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "remove"] },
        items: { type: "array", items: { type: "string" } },
      },
      required: ["action", "items"],
    },
  },
  // ── Search ──────────────────────────────────────────────────────────────────
  {
    name: "search_books",
    description: "Semantic search over the shared-books Pinecone namespace.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        topK: { type: "number", description: "Max results (default 5)." },
      },
      required: ["query"],
    },
  },
  {
    name: "search_movies",
    description: "Semantic search over the shared-movies Pinecone namespace.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        topK: { type: "number", description: "Max results (default 5)." },
      },
      required: ["query"],
    },
  },
  {
    name: "search_audible",
    description: "Semantic search over Kevin's Audible library (kevin-audible Pinecone namespace).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "web_search",
    description: "Run a web search via Anthropic's web_search tool and return a synthesized answer with source URLs.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." },
      },
      required: ["query"],
    },
  },
  // ── Lists ───────────────────────────────────────────────────────────────────
  {
    name: "get_list",
    description: "Return a named list (e.g. 'watchlist', 'wishlist') grouped by category.",
    inputSchema: {
      type: "object",
      properties: {
        listName: { type: "string", description: "The list name (e.g. 'watchlist')." },
      },
      required: ["listName"],
    },
  },
  {
    name: "add_to_list",
    description: "Add items to a named list. Items are categorized automatically via Haiku.",
    inputSchema: {
      type: "object",
      properties: {
        listName: { type: "string", description: "The list name (e.g. 'wishlist')." },
        items: { type: "array", items: { type: "string" } },
      },
      required: ["listName", "items"],
    },
  },
  {
    name: "fix_list_category",
    description: "Save a categorization correction so an item always appears in the right category.",
    inputSchema: {
      type: "object",
      properties: {
        item: { type: "string", description: "The item name to recategorize." },
        category: { type: "string", description: "The correct category." },
      },
      required: ["item", "category"],
    },
  },
  // ── Sports ──────────────────────────────────────────────────────────────────
  {
    name: "sports_next_game",
    description: "Return the next upcoming game for a team (scans 7 days ahead via ESPN).",
    inputSchema: {
      type: "object",
      properties: {
        team: { type: "string", description: "Team name or nickname (e.g. 'padres', 'lakers')." },
      },
      required: ["team"],
    },
  },
  {
    name: "sports_score",
    description: "Return the most recent score for a team (scans last 3 days via ESPN).",
    inputSchema: {
      type: "object",
      properties: {
        team: { type: "string", description: "Team name or nickname." },
      },
      required: ["team"],
    },
  },
  {
    name: "sports_schedule",
    description: "Return upcoming schedule for a team via ESPN.",
    inputSchema: {
      type: "object",
      properties: {
        team: { type: "string", description: "Team name or nickname." },
        games: { type: "number", description: "Number of games to return (default 5, max 20)." },
      },
      required: ["team"],
    },
  },
  {
    name: "sports_standings",
    description: "Return current league standings via ESPN.",
    inputSchema: {
      type: "object",
      properties: {
        league: { type: "string", enum: ["mlb", "nfl", "nba", "nhl"], description: "The league." },
      },
      required: ["league"],
    },
  },
  {
    name: "sports_player_stats",
    description: "Return player stats via ESPN.",
    inputSchema: {
      type: "object",
      properties: {
        player: { type: "string", description: "Player full name." },
        team: { type: "string", description: "Team name or nickname (used to infer sport)." },
      },
      required: ["player"],
    },
  },
  {
    name: "sports_calendar_bulk",
    description: "Add a team's full schedule to iCloud calendar, skipping games already there.",
    inputSchema: {
      type: "object",
      properties: {
        team: { type: "string", description: "Team name or nickname." },
        homeOnly: { type: "boolean", description: "Only add home games." },
        awayOnly: { type: "boolean", description: "Only add away games." },
      },
      required: ["team"],
    },
  },
  // ── Profile ─────────────────────────────────────────────────────────────────
  {
    name: "get_profile",
    description: "Return the current user profile (location, dietary prefs, hobbies, etc.).",
    inputSchema: { type: "object", properties: {} },
  },
];

// ── Dispatch ──────────────────────────────────────────────────────────────────

async function dispatch(name, args) {
  switch (name) {
    // Meal planning
    case "get_meal_plan":       return api("GET",    "/api/meals/plan");
    case "create_meal_plan":    return api("POST",   "/api/meals/create", args);
    case "clear_meal_plan":     return api("DELETE", "/api/meals/plan");
    case "swap_meal":           return api("POST",   "/api/meals/swap", args);
    case "get_grocery_list":    return api("GET",    "/api/meals/grocery");
    case "rebuild_grocery_list":return api("DELETE", "/api/meals/grocery");
    // Notes
    case "search_notes":        return api("POST",   "/api/notes/search", args);
    case "save_note":           return api("POST",   "/api/notes/save", args);
    // Recipes
    case "add_recipe":          return api("POST",   "/api/recipes/add", args);
    case "list_recipes":        return api("GET",    "/api/recipes/list");
    // Calendar
    case "get_upcoming_events": {
      const qs = args?.days ? `?days=${args.days}` : "";
      return api("GET", `/api/calendar/upcoming${qs}`);
    }
    case "create_calendar_event": return api("POST", "/api/calendar/create", args);
    // Pantry
    case "get_pantry":          return api("GET",    "/api/pantry");
    case "update_pantry":       return api("POST",   "/api/pantry", args);
    // Search
    case "search_books":        return api("POST",   "/api/search/books", args);
    case "search_movies":       return api("POST",   "/api/search/movies", args);
    case "search_audible":      return api("POST",   "/api/search/audible", args);
    case "web_search":          return api("POST",   "/api/search/web", { query: args.query });
    // Lists
    case "get_list":            return api("GET",    `/api/lists/${encodeURIComponent(args.listName)}`);
    case "add_to_list":         return api("POST",   `/api/lists/${encodeURIComponent(args.listName)}`, { items: args.items });
    case "fix_list_category":   return api("POST",   "/api/lists/correction", args);
    // Sports
    case "sports_next_game":    return api("GET",    `/api/sports/next?team=${encodeURIComponent(args.team)}`);
    case "sports_score":        return api("GET",    `/api/sports/score?team=${encodeURIComponent(args.team)}`);
    case "sports_schedule": {
      const qs = new URLSearchParams({ team: args.team, ...(args.games ? { games: String(args.games) } : {}) });
      return api("GET", `/api/sports/schedule?${qs}`);
    }
    case "sports_standings":    return api("GET",    `/api/sports/standings?league=${encodeURIComponent(args.league)}`);
    case "sports_player_stats": {
      const qs = new URLSearchParams({ player: args.player, ...(args.team ? { team: args.team } : {}) });
      return api("GET", `/api/sports/stats?${qs}`);
    }
    case "sports_calendar_bulk": return api("POST",  "/api/sports/calendar-bulk", args);
    // Profile
    case "get_profile":         return api("GET",    "/api/profile");
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "sonny", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    const result = await dispatch(name, args ?? {});
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
