import type { Book } from "@/lib/books/types";
import type { Movie } from "@/lib/movies/types";

export interface ChatCardAction {
  label: string; // e.g. "+ Add to library", "+ Add to watchlist"
  action: "add_book" | "add_movie";
  payload: Partial<Book> | Partial<Movie>;
}

export interface ChatCard {
  type: "book" | "movie";
  title: string;
  subtitle: string; // "by Andy Weir" | "2023 · Movie"
  coverUrl?: string;
  status?: string;
  inLibrary: boolean;
  actions: ChatCardAction[];
}
