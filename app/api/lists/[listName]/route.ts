// GET  /api/lists/:listName — return a named list grouped by category
// POST /api/lists/:listName — add items to a named list
// Body: { items: string[] }
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getList, addItems } from "@/lib/lists/store";
import { categorizeItems } from "@/lib/lists/categorize";
import { addToListIndex } from "@/lib/lists/index";

type Params = { params: Promise<{ listName: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { listName } = await params;
  const items = await getList(userId, listName);
  return NextResponse.json({ listName, items });
}

export async function POST(req: NextRequest, { params }: Params) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as { items?: string[] } | null;
  if (!Array.isArray(body?.items) || body.items.length === 0) {
    return NextResponse.json({ error: "items array required" }, { status: 400 });
  }

  const { listName } = await params;
  const updated = await addItems(userId, listName, body.items, categorizeItems);
  await addToListIndex(userId, listName);

  return NextResponse.json({ listName, items: updated });
}
