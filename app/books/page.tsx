"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import type { Book, BookStatus } from "@/lib/books/types";
import styles from "./books.module.css";

const TOKEN_KEY = "sonny_token";

const STATUS_FILTERS: { label: string; value: BookStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Reading", value: "reading" },
  { label: "Want to read", value: "want_to_read" },
  { label: "Finished", value: "finished" },
  { label: "On shelf", value: "shelf" },
];

const STATUS_LABEL: Record<BookStatus, string> = {
  reading: "Reading",
  want_to_read: "Want to read",
  finished: "Finished",
  shelf: "On shelf",
};

function coverUrl(book: Book): string | null {
  if (book.coverUrl) return book.coverUrl;
  if (book.isbn) return `https://covers.openlibrary.org/b/isbn/${book.isbn}-M.jpg`;
  return null;
}

function largeCoverUrl(book: Book): string | null {
  if (book.coverUrl) return book.coverUrl.replace(/-M\.jpg$/, "-L.jpg");
  if (book.isbn) return `https://covers.openlibrary.org/b/isbn/${book.isbn}-L.jpg`;
  return null;
}

function Stars({ rating }: { rating?: number }) {
  if (!rating) return null;
  return (
    <span className={styles.stars}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= rating ? styles.starFilled : styles.starEmpty}>
          ★
        </span>
      ))}
    </span>
  );
}

function CoverPlaceholder() {
  return <div className={styles.coverPlaceholder} />;
}

function CoverImg({ src, large }: { src: string | null; large?: boolean }) {
  const [err, setErr] = useState(false);
  if (!src || err) return <CoverPlaceholder />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={large ? styles.coverLarge : styles.coverThumb}
      onError={() => setErr(true)}
    />
  );
}

export default function BooksPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<BookStatus | "all">("all");
  const [selected, setSelected] = useState<Book | null>(null);

  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) { router.replace("/chat"); return; }
    setToken(t);
  }, [router]);

  useEffect(() => {
    if (!token) return;
    fetch("/api/library/books", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (r.status === 401) { localStorage.removeItem(TOKEN_KEY); router.replace("/chat"); return null; }
        return r.json();
      })
      .then((data) => { if (Array.isArray(data)) setBooks(data); })
      .finally(() => setLoading(false));
  }, [token, router]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return books.filter((b) => {
      if (statusFilter !== "all" && b.status !== statusFilter) return false;
      if (!q) return true;
      return (
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        (b.series ?? "").toLowerCase().includes(q)
      );
    });
  }, [books, search, statusFilter]);

  // Sort: reading first, then want_to_read, then shelf, then finished
  const sorted = useMemo(() => {
    const order: Record<BookStatus, number> = { reading: 0, want_to_read: 1, shelf: 2, finished: 3 };
    return [...filtered].sort((a, b) => order[a.status] - order[b.status]);
  }, [filtered]);

  return (
    <div className={styles.page}>
      {/* Detail overlay */}
      {selected && (
        <div className={styles.detail}>
          <div className={styles.detailHeader}>
            <button className={styles.backBtn} onClick={() => setSelected(null)}>
              <ArrowLeft size={18} />
              <span>Books</span>
            </button>
          </div>
          <div className={styles.detailBody}>
            <div className={styles.detailHero}>
              <CoverImg src={largeCoverUrl(selected)} large />
              <div className={styles.detailMeta}>
                <h2 className={styles.detailTitle}>{selected.title}</h2>
                <p className={styles.detailAuthor}>{selected.author}</p>
                {selected.series && (
                  <p className={styles.detailSeries}>
                    {selected.series}
                    {selected.seriesPosition != null ? ` · #${selected.seriesPosition}` : ""}
                  </p>
                )}
                <span className={`${styles.badge} ${styles[`badge_${selected.status}`]}`}>
                  {STATUS_LABEL[selected.status]}
                </span>
              </div>
            </div>

            <div className={styles.detailFields}>
              {selected.rating != null && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Rating</span>
                  <Stars rating={selected.rating} />
                </div>
              )}
              {selected.notes && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Notes</span>
                  <p className={styles.fieldValue}>{selected.notes}</p>
                </div>
              )}
              {selected.recommendedBy && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Recommended by</span>
                  <p className={styles.fieldValue}>{selected.recommendedBy}</p>
                </div>
              )}
              {(selected.dateStarted || selected.dateFinished || selected.dateAdded) && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Dates</span>
                  <div className={styles.dates}>
                    {selected.dateAdded && <span>Added: {selected.dateAdded}</span>}
                    {selected.dateStarted && <span>Started: {selected.dateStarted}</span>}
                    {selected.dateFinished && <span>Finished: {selected.dateFinished}</span>}
                  </div>
                </div>
              )}
              {selected.tags && selected.tags.length > 0 && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Tags</span>
                  <div className={styles.tags}>
                    {selected.tags.map((tag) => (
                      <span key={tag} className={styles.tag}>{tag}</span>
                    ))}
                  </div>
                </div>
              )}
              {selected.source && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Source</span>
                  <p className={styles.fieldValue}>{selected.source}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main list view */}
      <div className={styles.header}>
        <h1 className={styles.title}>Books</h1>
        <input
          className={styles.search}
          type="search"
          placeholder="Search titles, authors…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className={styles.filters}>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            className={`${styles.pill} ${statusFilter === f.value ? styles.activePill : ""}`}
            onClick={() => setStatusFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className={styles.list}>
        {loading && <p className={styles.empty}>Loading…</p>}
        {!loading && sorted.length === 0 && (
          <p className={styles.empty}>
            {books.length === 0
              ? "No books yet — ask Sonny to add one."
              : "No books match."}
          </p>
        )}
        {sorted.map((book) => (
          <button
            key={book.id}
            className={styles.row}
            onClick={() => setSelected(book)}
          >
            <CoverImg src={coverUrl(book)} />
            <div className={styles.rowBody}>
              <p className={styles.rowTitle}>{book.title}</p>
              <p className={styles.rowAuthor}>{book.author}</p>
              {book.series && (
                <p className={styles.rowSeries}>
                  {book.series}
                  {book.seriesPosition != null ? ` · #${book.seriesPosition}` : ""}
                </p>
              )}
            </div>
            <div className={styles.rowRight}>
              <span className={`${styles.badge} ${styles[`badge_${book.status}`]}`}>
                {STATUS_LABEL[book.status]}
              </span>
              <Stars rating={book.rating} />
            </div>
          </button>
        ))}
      </div>

      <BottomNav />
    </div>
  );
}
