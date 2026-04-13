import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getMovies, setMovies } from "@/lib/movies/store";
import type { Movie } from "@/lib/movies/types";

// Single atomic read-modify-write for multiple movies.
// Avoids the race condition that occurs when parallel PATCH calls each
// read the full array, update one movie, and write back — stomping each other.
export async function PATCH(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ids, updates } = await req.json() as {
    ids: string[];
    updates: Partial<Omit<Movie, "id">>;
  };

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids array required" }, { status: 400 });
  }

  const idSet = new Set(ids);
  const movies = await getMovies();
  const updatedMovies = movies.map((m) => idSet.has(m.id) ? { ...m, ...updates } : m);
  await setMovies(updatedMovies);

  return NextResponse.json(updatedMovies.filter((m) => idSet.has(m.id)));
}
