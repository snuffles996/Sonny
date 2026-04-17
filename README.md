# Sonny

Personal AI assistant for Kevin & Kylie. Next.js 14 App Router, deployed on Vercel.

## Remote MCP setup (claude.ai)

Connect Claude mobile and desktop directly to Sonny's backend via Settings → Connectors:

1. Go to **claude.ai → Settings → Connectors → Add Custom Connector**
2. **Name:** Sonny
3. **URL:** `https://sonny-snuffles996s-projects.vercel.app/api/mcp`
4. **Auth header:** `Authorization: Bearer YOUR_SECRET`
5. **Save** — the connector syncs automatically to Claude mobile and desktop

The MCP endpoint exposes 23 tools covering meal planning, notes, recipes, calendar, pantry, Pinecone search, web search, named lists, user profile, and sports scores. Auth uses the same Bearer token as the web UI (`KEVIN_SECRET` or `KYLIE_SECRET`).

## Local dev

```bash
npm run dev      # localhost:3000
npm run build    # TypeScript check + production build
npm run lint     # ESLint
```

## Local MCP server (Claude Desktop bridge)

For Claude Desktop (if not using the remote connector above):

```bash
# In Claude Desktop config (~/.config/claude/claude_desktop_config.json):
{
  "mcpServers": {
    "sonny": {
      "command": "node",
      "args": ["/path/to/Sonny/scripts/mcp-server.mjs"],
      "env": {
        "SONNY_BASE_URL": "https://sonny-snuffles996s-projects.vercel.app",
        "SONNY_TOKEN": "your-secret-here"
      }
    }
  }
}
```

## Deployment

Push to `main` → Vercel auto-deploys. Deployment protection must be **disabled** (Project Settings → Deployment Protection) so MCP and API clients can reach the endpoints without Vercel SSO intercepting requests.
