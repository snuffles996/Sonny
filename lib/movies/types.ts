export type MovieStatus = "maybe" | "watchlist" | "watching" | "seen";

export interface Movie {
  id: string;
  title: string;
  type: "movie" | "tv";
  director?: string;
  year?: number;
  runtime?: string;
  seasons?: number;
  currentSeason?: number;
  currentEpisode?: number;
  status: MovieStatus;
  recommendedBy?: string;
  rating?: number; // 1–5
  notes?: string;
  tags?: string[];
  streamingOn?: string[];
  coverUrl?: string; // TMDB: image.tmdb.org/t/p/w185/{poster_path}
  tmdbId?: number;
  dateWatched?: string;
  dateAdded?: string;
}
