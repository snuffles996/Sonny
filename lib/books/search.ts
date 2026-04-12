// Google Books API — no key required for basic usage
const GOOGLE_BOOKS_BASE = "https://www.googleapis.com/books/v1/volumes";

export interface BookResult {
  title: string;
  authors: string[];
  description: string;
  publishedDate: string;
  pageCount?: number;
  categories?: string[];
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.items.map((item: any): BookResult => {
    const info = item.volumeInfo;
    const title: string = info.title ?? "Unknown";
    const authors: string[] = info.authors ?? [];
    const searchTerm = encodeURIComponent(`${title} ${authors[0] ?? ""}`);

    return {
      title,
      authors,
      description: info.description ? info.description.slice(0, 400) : "",
      publishedDate: info.publishedDate ?? "",
      pageCount: info.pageCount,
      categories: info.categories,
      isbn: info.industryIdentifiers?.find((id: { type: string }) => id.type === "ISBN_13")?.identifier,
      audibleSearchUrl: `https://www.audible.com/search?keywords=${searchTerm}`,
      googleBooksUrl: info.infoLink ?? "",
    };
  });
}
