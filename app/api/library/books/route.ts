import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getBooks, addBook, updateBook, deleteBook } from "@/lib/books/store";
import type { Book } from "@/lib/books/types";

export async function GET(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const books = await getBooks(userId);
  return NextResponse.json(books);
}

export async function POST(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json() as Book;
  if (!body.id || !body.title || !body.author) {
    return NextResponse.json({ error: "id, title, and author are required" }, { status: 400 });
  }
  await addBook(userId, body);
  return NextResponse.json(body, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, ...updates } = await req.json() as Partial<Book> & { id: string };
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const updated = await updateBook(userId, id, updates);
  if (!updated) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  const userId = authenticateUser(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 });
  await deleteBook(userId, id);
  return NextResponse.json({ ok: true });
}
