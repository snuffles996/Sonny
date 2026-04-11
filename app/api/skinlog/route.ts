import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getEntries, addEntry, deleteEntry } from "@/lib/skinlog/store";
import type { TimeOfDay, SkinProduct } from "@/lib/skinlog/types";

export async function GET(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const entries = await getEntries(userId);
  return NextResponse.json({ entries });
}

export async function POST(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    date?: string;
    time?: TimeOfDay;
    products?: SkinProduct[];
    symptoms?: string;
    rating?: number;
    notes?: string;
  };

  if (!body.date || !body.time || !body.rating) {
    return NextResponse.json({ error: "date, time, and rating are required" }, { status: 400 });
  }

  const entry = await addEntry(userId, {
    date: body.date,
    time: body.time,
    products: body.products ?? [],
    symptoms: body.symptoms ?? "",
    rating: Math.min(5, Math.max(1, body.rating)) as 1 | 2 | 3 | 4 | 5,
    notes: body.notes,
  });

  return NextResponse.json({ entry });
}

export async function DELETE(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { id?: string };
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await deleteEntry(userId, body.id);
  return NextResponse.json({ ok: true });
}
