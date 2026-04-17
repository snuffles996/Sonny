// POST /api/search/web — Anthropic web_search tool
// Body: { query: string }
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getProfile } from "@/lib/profile/store";
import { runWebSearch } from "@/lib/search/webSearch";

export async function POST(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as { query?: string } | null;
  if (!body?.query) return NextResponse.json({ error: "query required" }, { status: 400 });

  const profile = await getProfile(userId);
  const result = await runWebSearch(body.query, profile, []);
  return NextResponse.json({
    responseText: result.responseText,
    sourceUrls: result.sourceUrls,
    searchCount: result.searchCount,
  });
}
