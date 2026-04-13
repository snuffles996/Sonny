import { getRedisClient } from "@/lib/redis/client";
import type { Book } from "./types";

function key(userId: string) {
  return `library:${userId}:books`;
}

export async function getBooks(userId: string): Promise<Book[]> {
  const redis = getRedisClient();
  const data = await redis.get<Book[]>(key(userId));
  return data ?? [];
}

export async function setBooks(userId: string, books: Book[]): Promise<void> {
  const redis = getRedisClient();
  await redis.set(key(userId), books);
}

export async function addBook(userId: string, book: Book): Promise<void> {
  const books = await getBooks(userId);
  const idx = books.findIndex((b) => b.id === book.id);
  if (idx >= 0) {
    books[idx] = book;
  } else {
    books.push(book);
  }
  await setBooks(userId, books);
}

export async function updateBook(
  userId: string,
  id: string,
  updates: Partial<Omit<Book, "id">>
): Promise<Book | null> {
  const books = await getBooks(userId);
  const idx = books.findIndex((b) => b.id === id);
  if (idx < 0) return null;
  books[idx] = { ...books[idx], ...updates };
  await setBooks(userId, books);
  return books[idx];
}

export async function deleteBook(userId: string, id: string): Promise<void> {
  const books = await getBooks(userId);
  await setBooks(
    userId,
    books.filter((b) => b.id !== id)
  );
}
