// POST /api/cron — called by Vercel Cron on schedule
// Handles: pattern detection, cross-user detection, weekly briefing

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { job } = await req.json();

  // Guard: Vercel sends CRON_SECRET in Authorization header
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  switch (job) {
    case "pattern-detection":
      // TODO: scan Pinecone for emerging clusters
      break;
    case "cross-user-detection":
      // TODO: compare kevin + sarah notes for shared namespace candidates
      break;
    case "weekly-briefing":
      // TODO: generate + deliver weekly summary
      break;
    default:
      return NextResponse.json({ error: "Unknown job" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
