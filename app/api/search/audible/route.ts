// POST /api/search/audible — semantic search over kevin-audible Pinecone namespace
// Body: { query: string; topK?: number }
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { searchAudibleLibrary } from "@/lib/books/audible-library";

export async function POST(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as { query?: string } | null;
  if (!body?.query) return NextResponse.json({ error: "query required" }, { status: 400 });

  const results = await searchAudibleLibrary(body.query);
  return NextResponse.json({ results });
}
