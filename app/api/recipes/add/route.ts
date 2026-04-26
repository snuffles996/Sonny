// POST /api/recipes/add
// Body option A: { url } — extract recipe from URL via Haiku
// Body option B: { recipe: { name, content, cuisine, source?, servings?, totalTime?, photoUrl? } } — manual/photo entry
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { extractRecipeFromUrl } from "@/lib/recipes/extract";
import { addRecipe } from "@/lib/recipes/store";
import type { Recipe } from "@/lib/recipes/types";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function POST(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as {
    url?: string;
    recipe?: {
      slug?: string;
      name: string;
      content: string;
      cuisine: string;
      source?: string;
      servings?: number;
      totalTime?: string;
      photoUrl?: string;
      mealType?: "breakfast" | "lunch" | "dinner";
      notes?: string;
    };
  } | null;

  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  if (body.url) {
    const recipe = await extractRecipeFromUrl(body.url);
    if (!recipe) return NextResponse.json({ error: "Could not extract recipe from that URL" }, { status: 422 });
    await addRecipe(recipe);
    return NextResponse.json({ recipe, saved: true });
  }

  if (body.recipe) {
    const { name, content, cuisine, source, servings, totalTime, photoUrl, mealType, notes } = body.recipe;
    if (!name?.trim() || !content?.trim() || !cuisine?.trim()) {
      return NextResponse.json({ error: "name, content, and cuisine are required" }, { status: 400 });
    }
    const slug = (body.recipe as { slug?: string }).slug?.trim() || slugify(name);
    const recipe: Recipe = {
      slug,
      name: name.trim(),
      cuisine: cuisine.trim(),
      source: source?.trim() || "manual",
      content: content.trim(),
      mealType: mealType ?? "dinner",
      ...(servings != null && { servings }),
      ...(totalTime && { totalTime: totalTime.trim() }),
      ...(photoUrl && { photoUrl }),
      ...(notes && { notes: notes.trim() }),
      addedDate: new Date().toISOString().slice(0, 10),
    };
    await addRecipe(recipe);
    return NextResponse.json({ recipe, saved: true });
  }

  return NextResponse.json({ error: "Provide either url or recipe fields" }, { status: 400 });
}
