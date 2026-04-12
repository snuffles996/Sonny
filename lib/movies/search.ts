// TMDb API — requires TMDB_API_KEY env var (free at themoviedb.org/settings/api)
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";

export interface MovieResult {
  id: number;
  title: string;
  type: "movie" | "tv";
  overview: string;
  releaseDate: string;
  rating: number;
  voteCount: number;
  genres: string[];
  posterUrl: string | null;
  tmdbUrl: string;
  runtime?: number;   // movies only (minutes)
  seasons?: number;   // TV only
  status?: string;    // e.g. "Ended", "Returning Series"
}

async function tmdbFetch(path: string, params: Record<string, string> = {}) {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set("api_key", process.env.TMDB_API_KEY!);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`TMDb error: ${res.status}`);
  return res.json();
}

export async function searchMoviesAndTV(query: string, maxResults = 5): Promise<MovieResult[]> {
  if (!process.env.TMDB_API_KEY) {
    throw new Error("TMDB_API_KEY is not configured — add it to your environment variables");
  }

  const data = await tmdbFetch("/search/multi", { query, include_adult: "false" });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topResults = (data.results ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((r: any) => r.media_type === "movie" || r.media_type === "tv")
    .slice(0, maxResults);

  // Fetch detail for each result to get genre names, runtime, seasons
  const detailed = await Promise.all(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    topResults.map(async (r: any) => {
      const detail = await tmdbFetch(`/${r.media_type}/${r.id}`);
      return { ...r, detail };
    })
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return detailed.map((r: any): MovieResult => {
    const isTV = r.media_type === "tv";
    const d = r.detail;
    return {
      id: r.id,
      title: isTV ? r.name : r.title,
      type: isTV ? "tv" : "movie",
      overview: r.overview ?? "",
      releaseDate: isTV ? (r.first_air_date ?? "") : (r.release_date ?? ""),
      rating: Math.round((r.vote_average ?? 0) * 10) / 10,
      voteCount: r.vote_count ?? 0,
      genres: (d.genres ?? []).map((g: { name: string }) => g.name),
      posterUrl: r.poster_path ? `${TMDB_IMAGE_BASE}${r.poster_path}` : null,
      tmdbUrl: `https://www.themoviedb.org/${r.media_type}/${r.id}`,
      runtime: !isTV ? d.runtime : undefined,
      seasons: isTV ? d.number_of_seasons : undefined,
      status: d.status,
    };
  });
}
