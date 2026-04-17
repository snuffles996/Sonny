import type { PendingAction } from "./actions";
import type { UserId } from "@/lib/profile/types";
import { saveNote } from "@/lib/pinecone/records";
import { getMovies, addMovie, updateMovie } from "@/lib/movies/store";
import { getBooks, addBook, updateBook } from "@/lib/books/store";
import { searchMoviesAndTV } from "@/lib/movies/search";
import { searchBooks } from "@/lib/books/search";
import { addItemToList, isGroceryList } from "@/lib/lists/addItem";
import { handleListWrite } from "@/lib/lists/handler";
import { addToListIndex } from "@/lib/lists/index";
import { createEvent, USER_TIMEZONE, type EventDraft } from "@/lib/caldav/events";
import type { Movie } from "@/lib/movies/types";
import type { Book } from "@/lib/books/types";

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findMovieByTitle(movies: Movie[], title: string): Movie | undefined {
  const norm = normalizeTitle(title);
  return movies.find(
    (m) =>
      normalizeTitle(m.title).includes(norm) || norm.includes(normalizeTitle(m.title))
  );
}

function findBookByTitle(books: Book[], title: string): Book | undefined {
  const norm = normalizeTitle(title);
  return books.find(
    (b) =>
      normalizeTitle(b.title).includes(norm) || norm.includes(normalizeTitle(b.title))
  );
}

function makeMovieId(): string {
  return `movie-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeBookId(): string {
  return `book-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Convert Claude's natural-language calendar payload to EventDraft
function buildEventDraft(payload: Record<string, unknown>): EventDraft | null {
  const title = payload.title as string | undefined;
  const dateISO = payload.dateISO as string | undefined; // "YYYY-MM-DD"
  const timeLocal = payload.timeLocal as string | undefined; // "HH:MM"
  const durationMinutes = (payload.durationMinutes as number | undefined) ?? 60;
  const allDay = (payload.allDay as boolean | undefined) ?? !timeLocal;
  const location = payload.location as string | undefined;

  if (!title || !dateISO) return null;

  if (allDay) {
    const d = dateISO.replace(/-/g, "");
    return { title, startLocal: d, endLocal: d, allDay: true, timezone: USER_TIMEZONE, location };
  }

  if (!timeLocal) return null;
  const [year, month, day] = dateISO.split("-");
  const [hour, minute] = timeLocal.split(":");
  const startLocal = `${year}${month}${day}T${hour}${minute}00`;

  const startMs = new Date(`${dateISO}T${timeLocal}:00`).getTime();
  const endMs = startMs + durationMinutes * 60000;
  const endDate = new Date(endMs);
  const endLocal = [
    String(endDate.getFullYear()),
    String(endDate.getMonth() + 1).padStart(2, "0"),
    String(endDate.getDate()).padStart(2, "0"),
    "T",
    String(endDate.getHours()).padStart(2, "0"),
    String(endDate.getMinutes()).padStart(2, "0"),
    "00",
  ].join("");

  return { title, startLocal, endLocal, allDay: false, timezone: USER_TIMEZONE, location };
}

export async function executeConfirmedAction(
  action: PendingAction,
  userId: UserId
): Promise<{ reply: string }> {
  const { type, payload } = action;
  const today = new Date().toISOString().slice(0, 10);

  switch (type) {
    case "save_note": {
      const text = payload.text as string | undefined;
      if (!text) return { reply: "I couldn't save that — no text was provided." };
      await saveNote(userId, text);
      return { reply: "Saved." };
    }

    case "movie_update": {
      const title = payload.title as string | undefined;
      if (!title) return { reply: "I couldn't update that — no title was provided." };
      const movies = await getMovies();
      const movie = findMovieByTitle(movies, title);
      if (!movie) return { reply: `Couldn't find *${title}* in your library.` };

      const updates: Partial<Movie> = {};
      if (payload.status) updates.status = payload.status as Movie["status"];
      if (payload.rating != null) updates.rating = payload.rating as number;
      if (payload.currentSeason != null) updates.currentSeason = payload.currentSeason as number;
      if (payload.currentEpisode != null) updates.currentEpisode = payload.currentEpisode as number;
      if (updates.status === "seen") updates.dateWatched = today;

      await updateMovie(movie.id, updates);
      const statusPart = updates.status ? ` Marked as ${updates.status}.` : "";
      return { reply: `Updated *${movie.title}*.${statusPart}` };
    }

    case "movie_add": {
      const title = payload.title as string | undefined;
      if (!title) return { reply: "I couldn't add that — no title was provided." };
      const results = await searchMoviesAndTV(title).catch(() => []);
      const top = results[0];
      if (!top) return { reply: `Couldn't find *${title}* on TMDb. Try the full title.` };

      const status = (payload.status as Movie["status"] | undefined) ?? "watchlist";
      const currentSeason = payload.currentSeason as number | undefined;
      const currentEpisode = payload.currentEpisode as number | undefined;

      const movie: Movie = {
        id: makeMovieId(),
        title: top.title,
        type: top.type,
        year: top.releaseDate ? new Date(top.releaseDate).getFullYear() : undefined,
        seasons: top.seasons,
        runtime: top.runtime ? `${Math.floor(top.runtime / 60)}h ${top.runtime % 60}m` : undefined,
        coverUrl: top.posterUrl ?? undefined,
        tmdbId: top.id,
        status,
        currentSeason,
        currentEpisode,
        dateAdded: today,
      };
      await addMovie(movie);

      const progressPart = currentSeason != null
        ? ` (S${currentSeason}${currentEpisode != null ? `E${currentEpisode}` : ""})`
        : "";
      const statusLabel = status === "watching" ? "as watching" : "to your watchlist";
      return { reply: `Added *${movie.title}*${progressPart} ${statusLabel}.` };
    }

    case "book_update": {
      const title = payload.title as string | undefined;
      if (!title) return { reply: "I couldn't update that — no title was provided." };
      const books = await getBooks(userId);
      const book = findBookByTitle(books, title);
      if (!book) return { reply: `Couldn't find *${title}* in your library.` };

      const updates: Partial<Book> = {};
      if (payload.status) updates.status = payload.status as Book["status"];
      if (payload.rating != null) updates.rating = payload.rating as number;
      if (updates.status === "finished") updates.dateFinished = today;
      if (updates.status === "reading") updates.dateStarted = today;

      await updateBook(userId, book.id, updates);
      const statusPart = updates.status ? ` Marked as ${updates.status.replace(/_/g, " ")}.` : "";
      return { reply: `Updated *${book.title}*.${statusPart}` };
    }

    case "book_add": {
      const title = payload.title as string | undefined;
      const author = payload.author as string | undefined;
      if (!title) return { reply: "I couldn't add that — no title was provided." };
      const results = await searchBooks(author ? `${title} ${author}` : title).catch(() => []);
      const top = results[0];
      if (!top) return { reply: `Couldn't find *${title}* on Google Books. Try the full title and author.` };
      const isbn = top.isbn;
      const coverUrl = top.coverUrl ?? (isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg` : undefined);
      const book: Book = {
        id: makeBookId(),
        title: top.title,
        author: top.authors[0] ?? author ?? "Unknown",
        isbn,
        coverUrl,
        status: "want_to_read",
        source: "other",
        dateAdded: today,
      };
      await addBook(userId, book);
      return { reply: `Added *${book.title}* by ${book.author} to your library.` };
    }

    case "list_write": {
      const listName = (payload.listName as string | undefined) ?? "general";
      const items = (payload.items as string[] | undefined) ?? [];
      if (items.length === 0) return { reply: "Nothing to add." };
      const reply = await handleListWrite(userId, listName, items);
      await addToListIndex(userId, listName);
      return { reply };
    }

    case "list_add_item": {
      const listName = (payload.listName as string | undefined) ?? "general";
      const item = payload.item as string | undefined;
      if (!item) return { reply: "Nothing to add." };
      if (isGroceryList(listName)) {
        const reply = await handleListWrite(userId, listName, [item]);
        await addToListIndex(userId, listName);
        return { reply };
      }
      const result = await addItemToList({ userId, listName, itemName: item, itemType: "other" });
      return { reply: result.reply };
    }

    case "calendar_write": {
      const draft = buildEventDraft(payload);
      if (!draft) return { reply: "I couldn't create that event — missing title or date." };
      await createEvent(draft);
      const dateStr = draft.allDay
        ? draft.startLocal.slice(0, 8)
        : draft.startLocal.slice(0, 8);
      const d = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
      const timeStr =
        !draft.allDay && draft.startLocal.length > 8
          ? ` at ${draft.startLocal.slice(9, 11)}:${draft.startLocal.slice(11, 13)}`
          : "";
      const dateLabel = new Date(d).toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric", timeZone: USER_TIMEZONE,
      });
      return { reply: `Done — "${draft.title}" added for ${dateLabel}${timeStr}.` };
    }

    case "recipe_add": {
      return { reply: "To add a recipe, send me the URL directly and I'll extract it." };
    }

    default:
      return { reply: "I wasn't sure how to do that. Can you say a bit more?" };
  }
}
