// POST /api/recipes/upload-photo
// Accepts multipart form-data with a "photo" file field.
// Stores in Vercel Blob and returns the public URL.
import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { authenticateUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("photo");

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "photo file required" }, { status: 400 });
  }

  const ext = (file instanceof File ? file.name.split(".").pop() : null) ?? "jpg";
  const filename = `recipes/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;

  const blob = await put(filename, file, { access: "public" });
  return NextResponse.json({ url: blob.url });
}
