import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getRecipes, removeRecipe } from "@/lib/recipes/store";

export async function GET(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const recipes = await getRecipes();
  return NextResponse.json({ recipes });
}

export async function DELETE(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "slug query param required" }, { status: 400 });
  await removeRecipe(slug);
  return NextResponse.json({ ok: true });
}
