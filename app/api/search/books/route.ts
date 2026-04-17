// POST /api/search/books — semantic search over shared-books Pinecone namespace
// Body: { query: string; topK?: number }
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { embedQuery } from "@/lib/pinecone/records";
import { getIndex } from "@/lib/pinecone/client";

export async function POST(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as { query?: string; topK?: number } | null;
  if (!body?.query) return NextResponse.json({ error: "query required" }, { status: 400 });

  const vector = await embedQuery(body.query);
  const index = getIndex();
  const res = await index.namespace("shared-books").query({
    vector,
    topK: body.topK ?? 5,
    includeMetadata: true,
  });

  const results = (res.matches ?? []).map((m) => m.metadata?.text as string).filter(Boolean);
  return NextResponse.json({ results });
}
