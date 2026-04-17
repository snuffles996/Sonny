// GET /api/recipes/list — return all recipes from Redis
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getRecipes } from "@/lib/recipes/store";

export async function GET(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const recipes = await getRecipes();
  return NextResponse.json({ recipes });
}
