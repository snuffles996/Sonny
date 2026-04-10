// POST /api/notes — embed + upsert a note into Pinecone
// GET  /api/notes — semantic query against user's namespace + relevant shared namespaces

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  // TODO: embed text via Anthropic embeddings
  // TODO: upsert into correct Pinecone namespace (kevin-notes | sarah-notes)
  // TODO: async trigger Obsidian mirror write
  return NextResponse.json({ message: "notes POST stub" }, { status: 200 });
}

export async function GET(req: NextRequest) {
  // TODO: embed query
  // TODO: search user namespace + relevant shared namespaces
  return NextResponse.json({ message: "notes GET stub" }, { status: 200 });
}
