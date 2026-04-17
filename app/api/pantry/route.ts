// GET  /api/pantry — return pantry staples list
// POST /api/pantry — add or remove pantry items
// Body: { action: "add" | "remove", items: string[] }
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getPantryStaples, addStaples, removeStaples } from "@/lib/pantry/store";

export async function GET(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const staples = await getPantryStaples();
  return NextResponse.json({ staples });
}

export async function POST(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as { action?: string; items?: string[] } | null;
  if (!body?.action || !Array.isArray(body?.items) || body.items.length === 0) {
    return NextResponse.json({ error: "action and items are required" }, { status: 400 });
  }
  if (body.action !== "add" && body.action !== "remove") {
    return NextResponse.json({ error: "action must be 'add' or 'remove'" }, { status: 400 });
  }

  const updated = body.action === "add"
    ? await addStaples(body.items)
    : await removeStaples(body.items);

  return NextResponse.json({ staples: updated });
}
