#!/usr/bin/env node
/**
 * Sonny MCP stdio server — wraps the Sonny REST API for Claude Desktop.
 *
 * Required env vars (set in Claude Desktop config):
 *   SONNY_BASE_URL  — e.g. https://your-deployment.vercel.app
 *   SONNY_TOKEN     — your KEVIN_SECRET or KYLIE_SECRET value
 *
 * Claude Desktop config (~/.config/claude/claude_desktop_config.json on Mac):
 *   {
 *     "mcpServers": {
 *       "sonny": {
 *         "command": "node",
 *         "args": ["/path/to/Sonny/scripts/mcp-server.mjs"],
 *         "env": {
 *           "SONNY_BASE_URL": "https://your-deployment.vercel.app",
 *           "SONNY_TOKEN": "your-secret-here"
 *         }
 *       }
 *     }
 *   }
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
  {
    name: "get_meal_plan",
    description: "Return the current active meal plan, including all planned meals and serving count.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "swap_meal",
    description:
      "Swap one meal in the active plan for a different recipe. Provide targetSlug (the recipeSlug to replace) OR a natural-language message like 'swap the pasta'.",
    inputSchema: {
      type: "object",
      properties: {
        targetSlug: { type: "string", description: "The recipeSlug to replace." },
        message: { type: "string", description: "Natural-language swap request, used when targetSlug is not provided." },
        preferences: { type: "string", description: "Optional flavour hint (e.g. 'something quick', 'vegetarian')." },
      },
    },
  },
  {
    name: "get_grocery_list",
    description:
      "Return the grocery list for the active meal plan, grouped by category. Builds and caches automatically.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "search_notes",
    description: "Semantic search over your Sonny notes (Pinecone). Pass a natural-language query.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query." },
        topK: { type: "number", description: "Max results. Defaults to 5." },
      },
      required: ["query"],
    },
  },
  {
    name: "save_note",
    description:
      "Save a note to your Sonny memory (Pinecone). Prefix with today's date for temporal recall, e.g. 'April 17, 2026: ...'.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The note text to store." },
      },
      required: ["text"],
    },
  },
  {
    name: "add_recipe",
    description: "Fetch a recipe page by URL, extract structured data, and save it to Sonny's recipe library.",
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
    description: "Return all recipes in Sonny's library as a JSON array.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_upcoming_events",
    description: "Return upcoming iCloud calendar events.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "How many days ahead to fetch. Defaults to 7, max 30." },
      },
    },
  },
  {
    name: "create_calendar_event",
    description:
      "Create a calendar event in iCloud. startLocal / endLocal format: YYYYMMDDTHHMMSS for timed events, YYYYMMDD for all-day.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        startLocal: { type: "string", description: "e.g. 20260420T190000" },
        endLocal: { type: "string", description: "e.g. 20260420T210000" },
        allDay: { type: "boolean" },
        timezone: { type: "string", description: "IANA timezone. Defaults to America/Los_Angeles." },
        location: { type: "string" },
        notes: { type: "string" },
      },
      required: ["title", "startLocal", "endLocal"],
    },
  },
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
];

// ── Dispatch ──────────────────────────────────────────────────────────────────

async function dispatch(name, args) {
  switch (name) {
    case "get_meal_plan":
      return api("GET", "/api/meals/plan");
    case "swap_meal":
      return api("POST", "/api/meals/swap", args);
    case "get_grocery_list":
      return api("GET", "/api/meals/grocery");
    case "search_notes":
      return api("POST", "/api/notes/search", args);
    case "save_note":
      return api("POST", "/api/notes/save", args);
    case "add_recipe":
      return api("POST", "/api/recipes/add", args);
    case "list_recipes":
      return api("GET", "/api/recipes/list");
    case "get_upcoming_events": {
      const qs = args?.days ? `?days=${args.days}` : "";
      return api("GET", `/api/calendar/upcoming${qs}`);
    }
    case "create_calendar_event":
      return api("POST", "/api/calendar/create", args);
    case "get_pantry":
      return api("GET", "/api/pantry");
    case "update_pantry":
      return api("POST", "/api/pantry", args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "sonny", version: "1.0.0" },
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
