// POST /api/mcp — Remote MCP server using Streamable HTTP transport
// Implements the MCP protocol for Claude.ai Settings → Connectors → Add Custom Connector
// Auth: Authorization: Bearer <KEVIN_SECRET or KYLIE_SECRET> header
//
// Each POST creates a fresh Server+Transport pair (stateless — no session persistence).
// The userId is captured in a closure so all tool handlers have auth context.

import { NextRequest } from "next/server";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { authenticateUser } from "@/lib/auth";
import { searchNotes, saveNote, embedQuery } from "@/lib/pinecone/records";
import { getIndex } from "@/lib/pinecone/client";
import {
  getActivePlan, saveActivePlan, clearGroceryList,
  getGroceryList, saveGroceryList,
} from "@/lib/mealplan/store";
import { getRecipes, addRecipe } from "@/lib/recipes/store";
import { selectMeals } from "@/lib/mealplan/select";
import { identifySwapTarget } from "@/lib/anthropic/mealplan";
import { buildGroceryList } from "@/lib/mealplan/grocery";
import { getCombinedExclusions } from "@/lib/mealplan/pantry";
import { extractRecipeFromUrl } from "@/lib/recipes/extract";
import { getUpcomingEvents, createEvent, USER_TIMEZONE, type EventDraft } from "@/lib/caldav/events";
import { isCalDAVConfigured } from "@/lib/caldav/client";
import { getPantryStaples, addStaples, removeStaples } from "@/lib/pantry/store";
import { searchAudibleLibrary } from "@/lib/books/audible-library";
import { runWebSearch } from "@/lib/search/webSearch";
import { getList, addItems } from "@/lib/lists/store";
import { categorizeItems } from "@/lib/lists/categorize";
import { addToListIndex, getUserListIndex } from "@/lib/lists/index";
import { getProfile, saveProfile } from "@/lib/profile/store";
import { extractProfileUpdate } from "@/lib/anthropic/profile";
import { detectTeam, findGame, getScore, getStandings } from "@/lib/sports/lookup";
import type { MealPlan, PlannedMeal } from "@/lib/mealplan/types";
import type { UserId } from "@/lib/profile/types";

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  // Notes
  { name: "sonny_search_notes", description: "Semantic search over your Sonny notes (Pinecone). Returns the most relevant stored notes.", inputSchema: { type: "object", properties: { query: { type: "string" }, topK: { type: "number", description: "Max results (default 5)" } }, required: ["query"] } },
  { name: "sonny_save_note", description: "Save a note to Sonny memory (Pinecone). Prefix with today's date for temporal recall, e.g. 'April 17, 2026: ...'.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },

  // Meal planning
  { name: "sonny_get_meal_plan", description: "Return the current active meal plan, including all planned meals and serving count.", inputSchema: { type: "object", properties: {} } },
  { name: "sonny_create_meal_plan", description: "Run Sonnet meal selection and save a new active plan. Respects dietary preferences from the user's profile.", inputSchema: { type: "object", properties: { count: { type: "number", description: "Number of meals to plan (default 4, max 7)" }, preferences: { type: "string", description: "Optional flavour hint, e.g. 'something light this week'" } } } },
  { name: "sonny_swap_meal", description: "Swap one meal in the active plan. Provide targetSlug (the recipeSlug to replace) OR a natural-language message like 'swap the pasta'.", inputSchema: { type: "object", properties: { targetSlug: { type: "string", description: "recipeSlug to replace" }, message: { type: "string", description: "Natural-language swap request (used when targetSlug is omitted)" }, preferences: { type: "string", description: "Optional flavour hint for the replacement" } } } },
  { name: "sonny_get_grocery_list", description: "Return the grocery list for the active meal plan, grouped by category. Builds and caches automatically.", inputSchema: { type: "object", properties: {} } },

  // Recipes
  { name: "sonny_add_recipe", description: "Fetch a recipe page by URL, extract structured data via Haiku, and save it to the library.", inputSchema: { type: "object", properties: { url: { type: "string", description: "Full URL of the recipe page" } }, required: ["url"] } },
  { name: "sonny_list_recipes", description: "Return all recipes in the library.", inputSchema: { type: "object", properties: {} } },

  // Calendar
  { name: "sonny_get_calendar", description: "Return upcoming iCloud calendar events as formatted text.", inputSchema: { type: "object", properties: { days: { type: "number", description: "Days ahead to fetch (default 7, max 30)" } } } },
  { name: "sonny_create_event", description: "Create an event in iCloud. startLocal/endLocal: YYYYMMDDTHHMMSS for timed events, YYYYMMDD for all-day.", inputSchema: { type: "object", properties: { title: { type: "string" }, startLocal: { type: "string", description: "e.g. 20260420T190000" }, endLocal: { type: "string", description: "e.g. 20260420T210000" }, allDay: { type: "boolean" }, timezone: { type: "string", description: "IANA timezone (default America/Los_Angeles)" }, location: { type: "string" }, notes: { type: "string" } }, required: ["title", "startLocal", "endLocal"] } },

  // Pantry
  { name: "sonny_get_pantry", description: "Return the shared pantry staples list. These items are excluded from grocery lists.", inputSchema: { type: "object", properties: {} } },
  { name: "sonny_update_pantry", description: "Add or remove items from the shared pantry staples list.", inputSchema: { type: "object", properties: { action: { type: "string", enum: ["add", "remove"] }, items: { type: "array", items: { type: "string" } } }, required: ["action", "items"] } },

  // Search
  { name: "sonny_search_books", description: "Semantic search over the shared-books Pinecone namespace.", inputSchema: { type: "object", properties: { query: { type: "string" }, topK: { type: "number" } }, required: ["query"] } },
  { name: "sonny_search_movies", description: "Semantic search over the shared-movies Pinecone namespace.", inputSchema: { type: "object", properties: { query: { type: "string" }, topK: { type: "number" } }, required: ["query"] } },
  { name: "sonny_search_audible", description: "Semantic search over Kevin's Audible library (kevin-audible namespace).", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "sonny_web_search", description: "Run a web search via Anthropic's web_search tool and return a synthesized answer with source URLs.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },

  // Lists
  { name: "sonny_list_all_lists", description: "Return all list names the user has created (e.g. 'watchlist', 'books', 'wishlist'). Use this before sonny_get_list when you don't know the list name.", inputSchema: { type: "object", properties: {} } },
  { name: "sonny_get_list", description: "Return a named list (e.g. 'watchlist', 'wishlist') grouped by category.", inputSchema: { type: "object", properties: { listName: { type: "string", description: "e.g. 'watchlist'" } }, required: ["listName"] } },
  { name: "sonny_update_list", description: "Add items to a named list. Items are auto-categorized via Haiku.", inputSchema: { type: "object", properties: { listName: { type: "string" }, items: { type: "array", items: { type: "string" } } }, required: ["listName", "items"] } },

  // Profile
  { name: "sonny_get_profile", description: "Return the current user profile (location, dietary prefs, hobbies, etc.).", inputSchema: { type: "object", properties: {} } },
  { name: "sonny_update_profile", description: "Update user profile fields via natural language (e.g. 'I moved to San Diego' or 'I'm now vegetarian').", inputSchema: { type: "object", properties: { raw: { type: "string", description: "Natural language description of the changes" } }, required: ["raw"] } },

  // Sports
  { name: "sonny_sports_next", description: "Return the next upcoming game for a team via ESPN (scans 7 days ahead).", inputSchema: { type: "object", properties: { team: { type: "string", description: "Team name or nickname, e.g. 'padres' or 'lakers'" } }, required: ["team"] } },
  { name: "sonny_sports_score", description: "Return the most recent score for a team via ESPN (scans last 3 days).", inputSchema: { type: "object", properties: { team: { type: "string" } }, required: ["team"] } },
  { name: "sonny_sports_standings", description: "Return current league standings via ESPN.", inputSchema: { type: "object", properties: { league: { type: "string", enum: ["mlb", "nfl", "nba", "nhl"] } }, required: ["league"] } },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const LEAGUE_MAP = {
  mlb: "baseball/mlb",
  nfl: "football/nfl",
  nba: "basketball/nba",
  nhl: "hockey/nhl",
} as const;

type A = Record<string, unknown>;

// ── Tool dispatch ─────────────────────────────────────────────────────────────

async function callTool(name: string, args: A, userId: UserId): Promise<unknown> {
  switch (name) {

    // ── Notes ──────────────────────────────────────────────────────────────────
    case "sonny_search_notes": {
      const results = await searchNotes(userId, args.query as string, (args.topK as number) ?? 5);
      return { results };
    }
    case "sonny_save_note": {
      const id = await saveNote(userId, args.text as string);
      return { id, saved: true };
    }

    // ── Meal planning ──────────────────────────────────────────────────────────
    case "sonny_get_meal_plan": {
      const plan = await getActivePlan();
      if (!plan) return { error: "No active plan" };
      return { plan };
    }
    case "sonny_create_meal_plan": {
      const count = Math.min((args.count as number) ?? 4, 7);
      const [recipes, activePlan, profile] = await Promise.all([
        getRecipes(), getActivePlan(), getProfile(userId),
      ]);
      const suggestions = await selectMeals({
        allRecipes: recipes, activePlan, profile,
        busyNights: [], count,
        preferences: args.preferences as string | undefined,
      });
      if (suggestions.length === 0) return { error: "No recipes match current preferences" };
      const planMeals: PlannedMeal[] = suggestions.map((s) => ({
        recipeSlug: s.recipe.slug, recipeName: s.recipe.name, addedBy: userId, made: false,
      }));
      const newPlan: MealPlan = {
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        updatedBy: userId, meals: planMeals,
        servings: parseInt(process.env.DEFAULT_SERVINGS ?? "2", 10),
      };
      await saveActivePlan(newPlan);
      await clearGroceryList();
      return { plan: newPlan, suggestions: suggestions.map((s) => ({ name: s.recipe.name, reason: s.reason })) };
    }
    case "sonny_swap_meal": {
      const plan = await getActivePlan();
      if (!plan || plan.meals.length === 0) return { error: "No active meal plan" };
      let targetSlug: string | null = (args.targetSlug as string) ?? null;
      if (!targetSlug) {
        if (!args.message) return { error: "targetSlug or message required" };
        targetSlug = await identifySwapTarget(args.message as string, plan.meals);
        if (!targetSlug) return { error: "Could not identify which meal to swap" };
      }
      const idx = plan.meals.findIndex((m) => m.recipeSlug === targetSlug);
      if (idx === -1) return { error: `Meal '${targetSlug}' not in active plan` };
      const [recipes, profile] = await Promise.all([getRecipes(), getProfile(userId)]);
      const replacement = await selectMeals({
        allRecipes: recipes, activePlan: plan, profile,
        busyNights: [], count: 1,
        preferences: ((args.preferences ?? args.message) as string | undefined),
      });
      if (replacement.length === 0) return { error: "No suitable replacement found" };
      const newMeal = replacement[0];
      const oldName = plan.meals[idx].recipeName;
      plan.meals[idx] = { recipeSlug: newMeal.recipe.slug, recipeName: newMeal.recipe.name, addedBy: userId, made: false };
      plan.updatedAt = new Date().toISOString();
      plan.updatedBy = userId;
      await saveActivePlan(plan);
      await clearGroceryList();
      return { swapped: true, removed: { name: oldName }, added: { name: newMeal.recipe.name, reason: newMeal.reason } };
    }
    case "sonny_get_grocery_list": {
      const plan = await getActivePlan();
      if (!plan) return { error: "No active plan" };
      const cached = await getGroceryList();
      if (cached) return { items: cached.items, checkedItems: cached.checkedItems };
      const [recipes, exclusions] = await Promise.all([getRecipes(), getCombinedExclusions()]);
      const items = await buildGroceryList(plan.meals, recipes, plan.servings, exclusions);
      await saveGroceryList(items);
      return { items, checkedItems: [] };
    }

    // ── Recipes ────────────────────────────────────────────────────────────────
    case "sonny_add_recipe": {
      const recipe = await extractRecipeFromUrl(args.url as string);
      if (!recipe) return { error: "Could not extract recipe from that URL" };
      await addRecipe(recipe);
      return { recipe, saved: true };
    }
    case "sonny_list_recipes":
      return { recipes: await getRecipes() };

    // ── Calendar ───────────────────────────────────────────────────────────────
    case "sonny_get_calendar": {
      if (!isCalDAVConfigured()) return { error: "Calendar not configured" };
      const days = Math.min((args.days as number) ?? 7, 30);
      const events = await getUpcomingEvents(days);
      return { events };
    }
    case "sonny_create_event": {
      if (!isCalDAVConfigured()) return { error: "Calendar not configured" };
      const draft: EventDraft = {
        title: args.title as string,
        startLocal: args.startLocal as string,
        endLocal: args.endLocal as string,
        allDay: (args.allDay as boolean) ?? false,
        timezone: (args.timezone as string) ?? USER_TIMEZONE,
        location: args.location as string | undefined,
        notes: args.notes as string | undefined,
      };
      await createEvent(draft);
      return { created: true, event: draft };
    }

    // ── Pantry ─────────────────────────────────────────────────────────────────
    case "sonny_get_pantry":
      return { staples: await getPantryStaples() };
    case "sonny_update_pantry": {
      const items = args.items as string[];
      const updated = args.action === "add" ? await addStaples(items) : await removeStaples(items);
      return { staples: updated };
    }

    // ── Search ─────────────────────────────────────────────────────────────────
    case "sonny_search_books": {
      const vector = await embedQuery(args.query as string);
      const res = await getIndex().namespace("shared-books").query({ vector, topK: (args.topK as number) ?? 5, includeMetadata: true });
      return { results: (res.matches ?? []).map((m) => m.metadata?.text as string).filter(Boolean) };
    }
    case "sonny_search_movies": {
      const vector = await embedQuery(args.query as string);
      const res = await getIndex().namespace("shared-movies").query({ vector, topK: (args.topK as number) ?? 5, includeMetadata: true });
      return { results: (res.matches ?? []).map((m) => m.metadata?.text as string).filter(Boolean) };
    }
    case "sonny_search_audible":
      return { results: await searchAudibleLibrary(args.query as string) };
    case "sonny_web_search": {
      const profile = await getProfile(userId);
      const result = await runWebSearch(args.query as string, profile, []);
      return { responseText: result.responseText, sourceUrls: result.sourceUrls };
    }

    // ── Lists ──────────────────────────────────────────────────────────────────
    case "sonny_list_all_lists":
      return { lists: await getUserListIndex(userId) };
    case "sonny_get_list":
      return { listName: args.listName, items: await getList(userId, args.listName as string) };
    case "sonny_update_list": {
      const listName = args.listName as string;
      const updated = await addItems(userId, listName, args.items as string[], categorizeItems);
      await addToListIndex(userId, listName);
      return { listName, items: updated };
    }

    // ── Profile ────────────────────────────────────────────────────────────────
    case "sonny_get_profile":
      return { profile: await getProfile(userId) };
    case "sonny_update_profile": {
      const profile = await getProfile(userId);
      const updates = await extractProfileUpdate(args.raw as string, profile);
      if (Object.keys(updates).length === 0) return { error: "No recognizable profile fields in that text" };
      const updated = await saveProfile(userId, updates);
      return { profile: updated, updatedFields: Object.keys(updates) };
    }

    // ── Sports ─────────────────────────────────────────────────────────────────
    case "sonny_sports_next": {
      const team = detectTeam(args.team as string);
      if (!team) return { error: `Team not recognized: ${args.team}` };
      const now = new Date();
      for (let i = 0; i < 7; i++) {
        const d = new Date(now.getTime() + i * 86400000);
        const stamp = d.toLocaleDateString("en-CA", { timeZone: USER_TIMEZONE }).replace(/-/g, "");
        const game = await findGame(team, stamp);
        if (game) return { team: team.fullName, game };
      }
      return { error: `No ${team.fullName} games found in the next 7 days` };
    }
    case "sonny_sports_score": {
      const team = detectTeam(args.team as string);
      if (!team) return { error: `Team not recognized: ${args.team}` };
      const score = await getScore(team, 3);
      return score ? { team: team.fullName, score } : { error: `No recent score for ${team.fullName}` };
    }
    case "sonny_sports_standings": {
      const sport = LEAGUE_MAP[(args.league as string).toLowerCase() as keyof typeof LEAGUE_MAP];
      if (!sport) return { error: "league must be one of: mlb, nfl, nba, nhl" };
      return { league: args.league, standings: await getStandings(sport) };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Server factory ────────────────────────────────────────────────────────────
// Creates a fresh Server+Transport pair per request. Stateless — no session
// persistence, which is correct for Vercel serverless functions.

function buildServer(userId: UserId) {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
  });

  const server = new Server(
    { name: "sonny", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: toolArgs } = req.params;
    try {
      const result = await callTool(name, (toolArgs ?? {}) as A, userId);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  });

  return { server, transport };
}

// ── Route handlers ────────────────────────────────────────────────────────────

function unauthorized() {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }),
    { status: 401, headers: { "Content-Type": "application/json" } }
  );
}

// Accept auth from Bearer header OR ?token= query param (for claude.ai connector URL)
function authenticateMcp(req: NextRequest): import("@/lib/profile/types").UserId | null {
  const fromHeader = authenticateUser(req);
  if (fromHeader) return fromHeader;
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (token === process.env.KEVIN_SECRET) return "kevin";
  if (token === process.env.KYLIE_SECRET) return "kylie";
  return null;
}

// POST — handles initialize, tools/list, tools/call (and notification acks)
export async function POST(req: NextRequest) {
  const userId = authenticateMcp(req);
  if (!userId) return unauthorized();

  const { server, transport } = buildServer(userId);
  await server.connect(transport);
  return transport.handleRequest(req);
}

// GET — SSE stream for server-to-client push (stateless: nothing to push, handled by SDK)
export async function GET(req: NextRequest) {
  const userId = authenticateMcp(req);
  if (!userId) return unauthorized();

  const { server, transport } = buildServer(userId);
  await server.connect(transport);
  return transport.handleRequest(req);
}

// DELETE — session termination (stateless: nothing to clean up)
export async function DELETE(req: NextRequest) {
  const userId = authenticateMcp(req);
  if (!userId) return unauthorized();
  return new Response(null, { status: 204 });
}
