// POST /api/notes/save — save a note to Pinecone
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { saveNote } from "@/lib/pinecone/records";

export async function POST(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as { text?: string } | null;
  if (!body?.text) return NextResponse.json({ error: "text required" }, { status: 400 });

  const id = await saveNote(userId, body.text);
  return NextResponse.json({ id, saved: true });
}
