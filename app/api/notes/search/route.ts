// POST /api/notes/search — semantic search in user's Pinecone namespace
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { searchNotes } from "@/lib/pinecone/records";

export async function POST(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as { query?: string; topK?: number } | null;
  if (!body?.query) return NextResponse.json({ error: "query required" }, { status: 400 });

  const results = await searchNotes(userId, body.query, body.topK ?? 5);
  return NextResponse.json({ results });
}
