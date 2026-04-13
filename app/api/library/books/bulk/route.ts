import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getBooks, setBooks } from "@/lib/books/store";
import type { Book } from "@/lib/books/types";

// Single atomic read-modify-write for multiple books.
// Avoids the race condition that occurs when parallel PATCH calls each
// read the full array, update one book, and write back — stomping each other.
export async function PATCH(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ids, updates } = await req.json() as {
    ids: string[];
    updates: Partial<Omit<Book, "id">>;
  };

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids array required" }, { status: 400 });
  }

  const idSet = new Set(ids);
  const books = await getBooks(userId);
  const updatedBooks = books.map((b) => idSet.has(b.id) ? { ...b, ...updates } : b);
  await setBooks(userId, updatedBooks);

  return NextResponse.json(updatedBooks.filter((b) => idSet.has(b.id)));
}
