"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
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
  if (book.coverUrl) return book.coverUrl;
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

  // Edit mode (detail overlay)
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editStatus, setEditStatus] = useState<BookStatus>("shelf");
  const [editRating, setEditRating] = useState<number | undefined>();
  const [editNotes, setEditNotes] = useState("");
  const [editDateStarted, setEditDateStarted] = useState("");
  const [editDateFinished, setEditDateFinished] = useState("");

  // Bulk select mode
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<BookStatus>("finished");
  const [bulkSaving, setBulkSaving] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) { router.replace("/chat"); return; }
    setToken(t);
  }, [router]);

  async function patchBook(id: string, updates: Partial<Book>) {
    if (!token) return;
    const res = await fetch("/api/library/books", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id, ...updates }),
    });
    if (!res.ok) return;
    const updated = await res.json() as Book;
    setBooks((prev) => prev.map((b) => b.id === id ? updated : b));
    if (selected?.id === id) setSelected(updated);
  }

  function startEdit(book: Book) {
    setEditStatus(book.status);
    setEditRating(book.rating);
    setEditNotes(book.notes ?? "");
    setEditDateStarted(book.dateStarted ?? "");
    setEditDateFinished(book.dateFinished ?? "");
    setEditing(true);
  }

  async function saveEdit() {
    if (!selected) return;
    setSaving(true);
    await patchBook(selected.id, {
      status: editStatus,
      rating: editRating || undefined,
      notes: editNotes.trim() || undefined,
      dateStarted: editDateStarted.trim() || undefined,
      dateFinished: editDateFinished.trim() || undefined,
    });
    setSaving(false);
    setEditing(false);
  }

  function toggleSelectMode() {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function applyBulk() {
    if (!selectedIds.size) return;
    setBulkSaving(true);
    await Promise.all(Array.from(selectedIds).map((id) => patchBook(id, { status: bulkStatus })));
    setBulkSaving(false);
    setSelectedIds(new Set());
    setSelectMode(false);
  }

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
            <button className={styles.backBtn} onClick={() => { setSelected(null); setEditing(false); }}>
              <ArrowLeft size={18} />
              <span>Books</span>
            </button>
            {editing ? (
              <div className={styles.editActions}>
                <button className={styles.cancelBtn} onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
                <button className={styles.saveBtn} onClick={saveEdit} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
              </div>
            ) : (
              <button className={styles.editBtn} onClick={() => startEdit(selected)}>
                <Pencil size={15} />
                <span>Edit</span>
              </button>
            )}
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
                {!editing && (
                  <span className={`${styles.badge} ${styles[`badge_${selected.status}`]}`}>
                    {STATUS_LABEL[selected.status]}
                  </span>
                )}
              </div>
            </div>

            {editing ? (
              <div className={styles.editForm}>
                <label className={styles.editLabel}>
                  Status
                  <select
                    className={styles.editSelect}
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as BookStatus)}
                  >
                    <option value="reading">Reading</option>
                    <option value="want_to_read">Want to read</option>
                    <option value="finished">Finished</option>
                    <option value="shelf">On shelf</option>
                  </select>
                </label>
                <label className={styles.editLabel}>
                  Rating (1–5)
                  <input
                    className={styles.editInput}
                    type="number"
                    min={1}
                    max={5}
                    value={editRating ?? ""}
                    placeholder="—"
                    onChange={(e) => setEditRating(e.target.value ? parseInt(e.target.value) : undefined)}
                  />
                </label>
                <label className={styles.editLabel}>
                  Notes
                  <textarea
                    className={`${styles.editInput} ${styles.editTextarea}`}
                    value={editNotes}
                    placeholder="Your thoughts…"
                    rows={3}
                    onChange={(e) => setEditNotes(e.target.value)}
                  />
                </label>
                <label className={styles.editLabel}>
                  Date started
                  <input
                    className={styles.editInput}
                    type="text"
                    value={editDateStarted}
                    placeholder="e.g. 2024-03-15"
                    onChange={(e) => setEditDateStarted(e.target.value)}
                  />
                </label>
                <label className={styles.editLabel}>
                  Date finished
                  <input
                    className={styles.editInput}
                    type="text"
                    value={editDateFinished}
                    placeholder="e.g. 2024-04-01"
                    onChange={(e) => setEditDateFinished(e.target.value)}
                  />
                </label>
              </div>
            ) : (
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
            )}
          </div>
        </div>
      )}

      {/* Main list view */}
      <div className={styles.header}>
        <div className={styles.headerRow}>
          <h1 className={styles.title}>Books</h1>
          <div className={styles.headerActions}>
            {selectMode && (
              <button
                className={styles.selectBtn}
                onClick={() => {
                  if (selectedIds.size === sorted.length) {
                    setSelectedIds(new Set());
                  } else {
                    setSelectedIds(new Set(sorted.map((b) => b.id)));
                  }
                }}
              >
                {selectedIds.size === sorted.length ? "Deselect all" : "Select all"}
              </button>
            )}
            <button className={styles.selectBtn} onClick={toggleSelectMode}>
              {selectMode ? "Cancel" : "Select"}
            </button>
          </div>
        </div>
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
        {sorted.map((book) => {
          const isChecked = selectedIds.has(book.id);
          return (
            <button
              key={book.id}
              className={`${styles.rowSelectable} ${isChecked ? styles.rowSelected : ""}`}
              onClick={() => selectMode ? toggleSelect(book.id) : setSelected(book)}
            >
              {selectMode && (
                <div className={`${styles.checkbox} ${isChecked ? styles.checkboxChecked : ""}`}>
                  {isChecked && <span className={styles.checkboxCheckmark}>✓</span>}
                </div>
              )}
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
          );
        })}
      </div>

      {selectMode && (
        <div className={styles.bulkBar}>
          <span className={styles.bulkCount}>
            {selectedIds.size} selected
          </span>
          <select
            className={styles.bulkSelect}
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value as BookStatus)}
          >
            <option value="finished">Finished</option>
            <option value="reading">Reading</option>
            <option value="want_to_read">Want to read</option>
            <option value="shelf">On shelf</option>
          </select>
          <button
            className={styles.bulkApply}
            onClick={applyBulk}
            disabled={!selectedIds.size || bulkSaving}
          >
            {bulkSaving ? "Saving…" : "Apply"}
          </button>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
