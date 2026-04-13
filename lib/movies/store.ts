import { getRedisClient } from "@/lib/redis/client";
import type { Movie } from "./types";

const KEY = "library:shared:movies";

export async function getMovies(): Promise<Movie[]> {
  const redis = getRedisClient();
  const data = await redis.get<Movie[]>(KEY);
  return data ?? [];
}

export async function setMovies(movies: Movie[]): Promise<void> {
  const redis = getRedisClient();
  await redis.set(KEY, movies);
}

export async function addMovie(movie: Movie): Promise<void> {
  const movies = await getMovies();
  const idx = movies.findIndex((m) => m.id === movie.id);
  if (idx >= 0) {
    movies[idx] = movie;
  } else {
    movies.push(movie);
  }
  await setMovies(movies);
}

export async function updateMovie(
  id: string,
  updates: Partial<Omit<Movie, "id">>
): Promise<Movie | null> {
  const movies = await getMovies();
  const idx = movies.findIndex((m) => m.id === id);
  if (idx < 0) return null;
  movies[idx] = { ...movies[idx], ...updates };
  await setMovies(movies);
  return movies[idx];
}

export async function deleteMovie(id: string): Promise<void> {
  const movies = await getMovies();
  await setMovies(movies.filter((m) => m.id !== id));
}
