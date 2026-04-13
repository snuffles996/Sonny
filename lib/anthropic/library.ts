import { getAnthropicClient, FAST_MODEL } from "./client";
import type { BookStatus } from "@/lib/books/types";
import type { MovieStatus } from "@/lib/movies/types";

export interface BookUpdateExtraction {
  titles: string[];
  status?: BookStatus;
  rating?: number;
  notes?: string;
  setDateStarted?: boolean;
  setDateFinished?: boolean;
}

export interface MovieUpdateExtraction {
  titles: string[];
  status?: MovieStatus;
  rating?: number;
  notes?: string;
  currentSeason?: number;
  currentEpisode?: number;
  setDateWatched?: boolean;
}

export async function extractBookUpdate(message: string): Promise<BookUpdateExtraction> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: FAST_MODEL,
    max_tokens: 300,
    system: "Extract a book update request. Infer status: 'finished' for 'I finished', 'reading' for 'I'm reading'/'started', 'want_to_read' for 'I want to read'. setDateStarted=true when starting, setDateFinished=true when finishing. Extract ALL book titles mentioned — there may be more than one.",
    messages: [{ role: "user", content: message }],
    tools: [
      {
        name: "extract_book_update",
        description: "Extract all book titles and the shared fields to update",
        input_schema: {
          type: "object" as const,
          properties: {
            titles: {
              type: "array",
              items: { type: "string" },
              description: "All book titles mentioned. One clean string per title.",
            },
            status: { type: "string", enum: ["shelf", "want_to_read", "reading", "finished"] },
            rating: { type: "number", description: "Star rating 1–5" },
            notes: { type: "string", description: "Notes to add" },
            setDateStarted: { type: "boolean" },
            setDateFinished: { type: "boolean" },
          },
          required: ["titles"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "extract_book_update" },
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return { titles: [message] };
  const raw = toolUse.input as BookUpdateExtraction & { title?: string };
  // Handle Haiku returning singular `title` instead of `titles`
  if (!raw.titles?.length && raw.title) return { ...raw, titles: [raw.title] };
  return raw;
}

export async function extractMovieUpdate(message: string): Promise<MovieUpdateExtraction> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: FAST_MODEL,
    max_tokens: 300,
    system: "Extract a movie/TV update request. Infer status: 'seen' for 'I watched'/'finished', 'watching' for 'I'm watching'/'currently watching'. Parse 'S2E4' or 'Season 2 Episode 4' into currentSeason/currentEpisode. setDateWatched=true when finishing. Extract ALL titles mentioned — there may be more than one.",
    messages: [{ role: "user", content: message }],
    tools: [
      {
        name: "extract_movie_update",
        description: "Extract all movie/TV titles and the shared fields to update",
        input_schema: {
          type: "object" as const,
          properties: {
            titles: {
              type: "array",
              items: { type: "string" },
              description: "All movie/TV titles mentioned. One clean string per title.",
            },
            status: { type: "string", enum: ["maybe", "watchlist", "watching", "seen"] },
            rating: { type: "number", description: "Star rating 1–5" },
            notes: { type: "string" },
            currentSeason: { type: "number" },
            currentEpisode: { type: "number" },
            setDateWatched: { type: "boolean" },
          },
          required: ["titles"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "extract_movie_update" },
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return { titles: [message] };
  const raw = toolUse.input as MovieUpdateExtraction & { title?: string };
  // Handle Haiku returning singular `title` instead of `titles`
  if (!raw.titles?.length && raw.title) return { ...raw, titles: [raw.title] };
  return raw;
}
