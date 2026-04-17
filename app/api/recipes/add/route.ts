// POST /api/recipes/add — extract recipe from URL and save to Redis
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { extractRecipeFromUrl } from "@/lib/recipes/extract";
import { addRecipe } from "@/lib/recipes/store";

export async function POST(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as { url?: string } | null;
  if (!body?.url) return NextResponse.json({ error: "url required" }, { status: 400 });

  const recipe = await extractRecipeFromUrl(body.url);
  if (!recipe) {
    return NextResponse.json({ error: "Could not extract recipe from that URL" }, { status: 422 });
  }

  await addRecipe(recipe);
  return NextResponse.json({ recipe, saved: true });
}
