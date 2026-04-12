# Sonny — Books & Movies Feature Spec

**Repo:** `snuffles996/Sonny`  
**Scope:** Add `book_search`, `audible_library`, and `movie_query` intents

---

## Intent Classification

Add to Haiku's classification tool in `lib/anthropic/classify.ts`:

```typescript
| "book_search"        // discover new books — "find a book about X", "my friend recommended..."
| "audible_library"    // search own library — "that book I have about...", "find in my audible"
| "movie_query"        // movies or TV — "what's that movie where...", "who's in...", "is X on Netflix"
```

**Routing logic for Haiku:**
- Route `audible_library` when message implies ownership: "I have", "in my library", "I bought", "I've been meaning to listen to"
- Route `book_search` for all other book/audiobook discovery queries
- Route `movie_query` for anything about movies or TV shows

---

## 1. Book Search — Google Books API

**No API key required** for basic usage. Add key later only if you hit rate limits.

### New file: `lib/books/search.ts`

```typescript
const GOOGLE_BOOKS_BASE = "https://www.googleapis.com/books/v1/volumes";

export interface BookResult {
  title: string;
  authors: string[];
  description: string;
  publishedDate: string;
  pageCount?: number;
  categories?: string[];
  thumbnail?: string;
  isbn?: string;
  audibleSearchUrl: string;
  googleBooksUrl: string;
}

export async function searchBooks(query: string, maxResults = 5): Promise<BookResult[]> {
  const params = new URLSearchParams({
    q: query,
    maxResults: String(maxResults),
    printType: "books",
    langRestrict: "en",
  });

  const res = await fetch(`${GOOGLE_BOOKS_BASE}?${params}`);
  if (!res.ok) throw new Error(`Google Books error: ${res.status}`);

  const data = await res.json();
  if (!data.items) return [];

  return data.items.map((item: any): BookResult => {
    const info = item.volumeInfo;
    const title = info.title ?? "Unknown";
    const authors = info.authors ?? [];
    const searchTerm = encodeURIComponent(`${title} ${authors[0] ?? ""}`);

    return {
      title,
      authors,
      description: info.description ?? "",
      publishedDate: info.publishedDate ?? "",
      pageCount: info.pageCount,
      categories: info.categories,
      thumbnail: info.imageLinks?.thumbnail,
      isbn: info.industryIdentifiers?.find((id: any) => id.type === "ISBN_13")?.identifier,
      audibleSearchUrl: `https://www.audible.com/search?keywords=${searchTerm}`,
      googleBooksUrl: info.infoLink ?? "",
    };
  });
}
```

---

## 2. Audible Library Search — Pinecone + Sync Script

Two parts: a one-time sync script to seed your library into Pinecone, and a runtime search handler.

### Sync script: `scripts/sync-audible.mjs`

Run manually after exporting your library via `audible-cli`, and re-run whenever you make new purchases.

**Prerequisites:**
```bash
pip install audible-cli
audible library export --output library.json
```

```javascript
// Usage: node scripts/sync-audible.mjs library.json

import { Pinecone } from "@pinecone-database/pinecone";
import { readFileSync } from "fs";

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.index(process.env.PINECONE_INDEX_NAME);

const NAMESPACE = "kevin-audible";

async function embedText(text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  const data = await res.json();
  return data.data[0].embedding;
}

async function syncLibrary(filePath) {
  const raw = JSON.parse(readFileSync(filePath, "utf8"));

  for (const book of raw) {
    const text = [
      book.title,
      book.authors?.join(", "),
      book.publisher,
      book.merchandising_summary,
      book.publisher_summary,
      book.categories?.join(", "),
      book.series?.join(", "),
    ]
      .filter(Boolean)
      .join(" | ");

    const embedding = await embedText(text);

    await index.namespace(NAMESPACE).upsert([
      {
        id: book.asin,
        values: embedding,
        metadata: {
          asin: book.asin,
          title: book.title,
          authors: book.authors?.join(", ") ?? "",
          narrator: book.narrators?.join(", ") ?? "",
          runtime_minutes: book.runtime_length_min ?? 0,
          purchase_date: book.purchase_date ?? "",
          series: book.series?.join(", ") ?? "",
          summary: (book.merchandising_summary ?? book.publisher_summary ?? "").slice(0, 500),
          audible_url: `https://www.audible.com/pd/${book.asin}`,
        },
      },
    ]);

    console.log(`Synced: ${book.title}`);
  }
}

syncLibrary(process.argv[2]);
```

> **Note on embedding model:** If you want to avoid the OpenAI dependency entirely, switch your Pinecone index to use **Pinecone's integrated inference** (`llama-text-embed-v2` — free within Pinecone's free tier). This removes the separate embedding API call. Worth deciding now, as switching would require re-seeding your existing `kevin-notes` namespace too.

### Runtime search: `lib/books/audible-library.ts`

```typescript
import { getPineconeClient } from "@/lib/pinecone/client";

export interface AudibleBook {
  asin: string;
  title: string;
  authors: string;
  narrator: string;
  runtime_minutes: number;
  series: string;
  summary: string;
  purchase_date: string;
  audible_url: string;
  score: number;
}

export async function searchAudibleLibrary(
  query: string,
  userId: string,
  topK = 5
): Promise<AudibleBook[]> {
  const pinecone = getPineconeClient();
  const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);

  const embedding = await embedQuery(query); // same model as sync script

  const results = await index.namespace("kevin-audible").query({
    vector: embedding,
    topK,
    includeMetadata: true,
  });

  return (results.matches ?? []).map((match) => ({
    asin: match.metadata?.asin as string,
    title: match.metadata?.title as string,
    authors: match.metadata?.authors as string,
    narrator: match.metadata?.narrator as string,
    runtime_minutes: match.metadata?.runtime_minutes as number,
    series: match.metadata?.series as string,
    summary: match.metadata?.summary as string,
    purchase_date: match.metadata?.purchase_date as string,
    audible_url: match.metadata?.audible_url as string,
    score: match.score ?? 0,
  }));
}
```

> Hardcoded to `kevin-audible` namespace for now. When Kylie is set up, add `kylie-audible` and route by `userId` — same pattern as notes.

---

## 3. Movie / TV Search — TMDb

Free, generous limits. Get a key at [themoviedb.org](https://www.themoviedb.org/settings/api) — takes about 2 minutes.

### New file: `lib/movies/search.ts`

```typescript
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
  runtime?: number;      // movies only
  seasons?: number;      // TV only
  status?: string;       // e.g. "Ended", "Returning Series"
}

async function tmdbFetch(path: string, params: Record<string, string> = {}) {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set("api_key", process.env.TMDB_API_KEY!);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`TMDb error: ${res.status}`);
  return res.json();
}

export async function searchMoviesAndTV(
  query: string,
  maxResults = 5
): Promise<MovieResult[]> {
  // /search/multi hits movies + TV shows in one call
  const data = await tmdbFetch("/search/multi", { query, include_adult: "false" });

  const results = (data.results ?? [])
    .filter((r: any) => r.media_type === "movie" || r.media_type === "tv")
    .slice(0, maxResults);

  // Fetch detail for each result to get runtime/seasons/genre names
  // (search results only return genre IDs, not names)
  const detailed = await Promise.all(
    results.map(async (r: any) => {
      const detail = await tmdbFetch(`/${r.media_type}/${r.id}`);
      return { ...r, detail };
    })
  );

  return detailed.map((r): MovieResult => {
    const isTV = r.media_type === "tv";
    const d = r.detail;
    return {
      id: r.id,
      title: isTV ? r.name : r.title,
      type: isTV ? "tv" : "movie",
      overview: r.overview,
      releaseDate: isTV ? r.first_air_date : r.release_date,
      rating: r.vote_average,
      voteCount: r.vote_count,
      genres: d.genres?.map((g: any) => g.name) ?? [],
      posterUrl: r.poster_path ? `${TMDB_IMAGE_BASE}${r.poster_path}` : null,
      tmdbUrl: `https://www.themoviedb.org/${r.media_type}/${r.id}`,
      runtime: !isTV ? d.runtime : undefined,
      seasons: isTV ? d.number_of_seasons : undefined,
      status: d.status,
    };
  });
}
```

---

## Chat Handler — `app/api/chat/route.ts`

Add to the existing intent switch:

```typescript
case "book_search": {
  const books = await searchBooks(message);
  context = `Google Books results:\n${JSON.stringify(books, null, 2)}`;
  break;
}

case "audible_library": {
  const books = await searchAudibleLibrary(message, userId);
  context = `Audible library matches:\n${JSON.stringify(books, null, 2)}`;
  break;
}

case "movie_query": {
  const titles = await searchMoviesAndTV(message);
  context = `TMDb results:\n${JSON.stringify(titles, null, 2)}`;
  break;
}
```

Sonnet receives the raw results as context and formats the response naturally — same pattern as sports and calendar handlers.

---

## New Environment Variables

| Variable | Purpose |
|---|---|
| `TMDB_API_KEY` | TMDb — free at themoviedb.org |
| `OPENAI_API_KEY` | Only needed if using OpenAI embeddings in sync script (skip if using Pinecone integrated inference) |

Add to Vercel environment and `.env.local`.

---

## New Pinecone Namespaces

| Namespace | Owner | Status |
|---|---|---|
| `kevin-audible` | Kevin | Add after running sync script |
| `kylie-audible` | Kylie | Later, same pattern |

---

## New Files Summary

```
lib/
  books/
    search.ts           — Google Books API (book discovery)
    audible-library.ts  — Pinecone semantic search over own library
  movies/
    search.ts           — TMDb API (movies + TV)

scripts/
  sync-audible.mjs      — one-time seed: Audible library export → Pinecone
```

---

## Recommended Build Order

1. **TMDb movie search** — purely stateless, no seeding, live in ~1 hour
2. **Google Books search** — same complexity, no API key even needed
3. **Audible library sync** — install `audible-cli`, export library JSON, run sync script, verify Pinecone results, wire runtime search
