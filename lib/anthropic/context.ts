import { getIndex, NAMESPACES } from "@/lib/pinecone/client";
import { embedQuery } from "@/lib/pinecone/records";
import { getActivePlan } from "@/lib/mealplan/store";
import { getMovies } from "@/lib/movies/store";
import { getBooks } from "@/lib/books/store";
import type { UserId } from "@/lib/profile/types";
import type { MealPlan } from "@/lib/mealplan/types";
import type { Movie } from "@/lib/movies/types";
import type { Book } from "@/lib/books/types";

export interface ContextMatch {
  text: string;
  score: number;
}

export interface BroadContext {
  notes: ContextMatch[];
  movies: ContextMatch[];
  restaurants: ContextMatch[];
  recipes: ContextMatch[];
  activeMealPlan: MealPlan | null;
  movieLibrary: Pick<Movie, "id" | "title" | "type" | "status" | "currentSeason" | "currentEpisode" | "year">[];
  bookLibrary: Pick<Book, "id" | "title" | "author" | "status">[];
}

const SCORE_THRESHOLD = 0.6;
const TOP_K = 4;

async function queryNamespace(
  vector: number[],
  namespace: string
): Promise<ContextMatch[]> {
  try {
    const result = await getIndex().namespace(namespace).query({
      vector,
      topK: TOP_K,
      includeMetadata: true,
    });
    return (result.matches ?? [])
      .filter((m) => (m.score ?? 0) >= SCORE_THRESHOLD)
      .map((m) => ({ text: m.metadata?.text as string, score: m.score ?? 0 }))
      .filter((m) => Boolean(m.text));
  } catch {
    return [];
  }
}

export async function loadBroadContext(
  userId: UserId,
  message: string
): Promise<BroadContext> {
  const notesNs =
    userId === "kevin" ? NAMESPACES.kevinNotes : NAMESPACES.kylieNotes;

  const [vector, activeMealPlan, allMovies, allBooks] = await Promise.all([
    embedQuery(message),
    getActivePlan(),
    getMovies(),
    getBooks(userId),
  ]);

  const [notes, movies, restaurants, recipes] = await Promise.all([
    queryNamespace(vector, notesNs),
    queryNamespace(vector, NAMESPACES.sharedMovies),
    queryNamespace(vector, NAMESPACES.sharedRestaurants),
    queryNamespace(vector, NAMESPACES.sharedRecipes),
  ]);

  const movieLibrary = allMovies.map((m) => ({
    id: m.id,
    title: m.title,
    type: m.type,
    status: m.status,
    currentSeason: m.currentSeason,
    currentEpisode: m.currentEpisode,
    year: m.year,
  }));

  const bookLibrary = allBooks.map((b) => ({
    id: b.id,
    title: b.title,
    author: b.author,
    status: b.status,
  }));

  return { notes, movies, restaurants, recipes, activeMealPlan, movieLibrary, bookLibrary };
}
