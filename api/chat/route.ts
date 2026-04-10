// POST /api/chat
// Main entry point: classifies intent, assembles context, calls Claude.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  // TODO: authenticate user (Kevin vs Sarah via header/token)
  // TODO: assemble context (profile + Pinecone + KV session turns + calendar if relevant)
  // TODO: classify intent with Claude
  // TODO: route to save / query / calendar / profile handler
  // TODO: return streaming response

  return NextResponse.json({ message: "chat endpoint stub" }, { status: 200 });
}
