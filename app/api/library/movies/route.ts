import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getMovies, addMovie, updateMovie, deleteMovie } from "@/lib/movies/store";
import type { Movie } from "@/lib/movies/types";

export async function GET(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const movies = await getMovies();
  return NextResponse.json(movies);
}

export async function POST(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json() as Movie;
  if (!body.id || !body.title) {
    return NextResponse.json({ error: "id and title are required" }, { status: 400 });
  }
  await addMovie(body);
  return NextResponse.json(body, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, ...updates } = await req.json() as Partial<Movie> & { id: string };
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const updated = await updateMovie(id, updates);
  if (!updated) return NextResponse.json({ error: "Movie not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 });
  await deleteMovie(id);
  return NextResponse.json({ ok: true });
}
