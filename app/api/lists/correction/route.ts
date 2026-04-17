// POST /api/lists/correction — save a categorization override
// Body: { item: string; category: string }
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { addOverride } from "@/lib/lists/overrides";

export async function POST(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as { item?: string; category?: string } | null;
  if (!body?.item || !body?.category) {
    return NextResponse.json({ error: "item and category are required" }, { status: 400 });
  }

  await addOverride(body.item, body.category);
  return NextResponse.json({ saved: true, item: body.item, category: body.category });
}
