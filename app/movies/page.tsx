"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import type { Movie, MovieStatus } from "@/lib/movies/types";
import styles from "./movies.module.css";

const TOKEN_KEY = "sonny_token";

const STATUS_FILTERS: { label: string; value: MovieStatus | "all" | "movies" | "tv" }[] = [
  { label: "All", value: "all" },
  { label: "Watching", value: "watching" },
  { label: "Watchlist", value: "watchlist" },
  { label: "Seen it", value: "seen" },
  { label: "Movies", value: "movies" },
  { label: "TV", value: "tv" },
];

const STATUS_LABEL: Record<MovieStatus, string> = {
  watching: "Watching",
  watchlist: "Watchlist",
  seen: "Seen it",
  maybe: "Maybe",
};

type FilterValue = MovieStatus | "all" | "movies" | "tv";

function Stars({ rating }: { rating?: number }) {
  if (!rating) return null;
  return (
    <span className={styles.stars}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= rating ? styles.starFilled : styles.starEmpty}>★</span>
      ))}
    </span>
  );
}

function PosterPlaceholder({ type }: { type: "movie" | "tv" }) {
  return (
    <div className={styles.posterPlaceholder}>
      <span>{type === "tv" ? "TV" : "🎬"}</span>
    </div>
  );
}

function PosterImg({ src, large, type }: { src: string | null; large?: boolean; type: "movie" | "tv" }) {
  const [err, setErr] = useState(false);
  if (!src || err) return <PosterPlaceholder type={type} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={large ? styles.posterLarge : styles.posterThumb}
      onError={() => setErr(true)}
    />
  );
}

function progressLabel(movie: Movie): string | null {
  if (movie.type !== "tv") return null;
  if (movie.currentSeason != null && movie.currentEpisode != null) {
    return `S${movie.currentSeason}·E${movie.currentEpisode}`;
  }
  if (movie.seasons != null) return `${movie.seasons} season${movie.seasons !== 1 ? "s" : ""}`;
  return null;
}

export default function MoviesPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterValue>("all");
  const [selected, setSelected] = useState<Movie | null>(null);

  // Edit mode (detail overlay)
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editStatus, setEditStatus] = useState<MovieStatus>("watchlist");
  const [editRating, setEditRating] = useState<number | undefined>();
  const [editNotes, setEditNotes] = useState("");
  const [editDateWatched, setEditDateWatched] = useState("");

  // Bulk select mode
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // null = field not active (won't be applied); non-null = explicitly set by user
  const [bulkStatus, setBulkStatus] = useState<MovieStatus | null>(null);
  const [bulkRating, setBulkRating] = useState<number | null>(null);
  const [bulkDateWatched, setBulkDateWatched] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) { router.replace("/chat"); return; }
    setToken(t);
  }, [router]);

  async function patchMovie(id: string, updates: Partial<Movie>) {
    if (!token) return;
    const res = await fetch("/api/library/movies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id, ...updates }),
    });
    if (!res.ok) return;
    const updated = await res.json() as Movie;
    setMovies((prev) => prev.map((m) => m.id === id ? updated : m));
    if (selected?.id === id) setSelected(updated);
  }

  function startEdit(movie: Movie) {
    setEditStatus(movie.status);
    setEditRating(movie.rating);
    setEditNotes(movie.notes ?? "");
    setEditDateWatched(movie.dateWatched ?? "");
    setEditing(true);
  }

  async function saveEdit() {
    if (!selected) return;
    setSaving(true);
    await patchMovie(selected.id, {
      status: editStatus,
      rating: editRating || undefined,
      notes: editNotes.trim() || undefined,
      dateWatched: editDateWatched.trim() || undefined,
    });
    setSaving(false);
    setEditing(false);
  }

  function toggleSelectMode() {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
    setBulkStatus(null);
    setBulkRating(null);
    setBulkDateWatched(null);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function removeMovie(id: string) {
    if (!token) return;
    await fetch(`/api/library/movies?id=${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    setMovies((prev) => prev.filter((m) => m.id !== id));
    setSelected(null);
    setEditing(false);
  }

  async function removeBulkMovies() {
    if (!selectedIds.size || !token) return;
    setBulkSaving(true);
    await Promise.all(
      Array.from(selectedIds).map((id) =>
        fetch(`/api/library/movies?id=${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        })
      )
    );
    setMovies((prev) => prev.filter((m) => !selectedIds.has(m.id)));
    setBulkSaving(false);
    setSelectedIds(new Set());
    setSelectMode(false);
  }

  async function applyBulk() {
    if (!selectedIds.size || !token) return;
    const updates: Partial<Movie> = {};
    if (bulkStatus !== null) updates.status = bulkStatus;
    if (bulkRating !== null) updates.rating = bulkRating;
    if (bulkDateWatched !== null && bulkDateWatched.trim()) updates.dateWatched = bulkDateWatched.trim();
    if (!Object.keys(updates).length) return;
    setBulkSaving(true);
    const res = await fetch("/api/library/movies/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ids: Array.from(selectedIds), updates }),
    });
    if (res.ok) {
      const updatedMovies = await res.json() as Movie[];
      const updatedMap = new Map(updatedMovies.map((m) => [m.id, m]));
      setMovies((prev) => prev.map((m) => updatedMap.get(m.id) ?? m));
    }
    setBulkSaving(false);
    setSelectedIds(new Set());
    setBulkStatus(null);
    setBulkRating(null);
    setBulkDateWatched(null);
    setSelectMode(false);
  }

  useEffect(() => {
    if (!token) return;
    fetch("/api/library/movies", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (r.status === 401) { localStorage.removeItem(TOKEN_KEY); router.replace("/chat"); return null; }
        return r.json();
      })
      .then((data) => { if (Array.isArray(data)) setMovies(data); })
      .finally(() => setLoading(false));
  }, [token, router]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return movies.filter((m) => {
      if (filter === "movies" && m.type !== "movie") return false;
      if (filter === "tv" && m.type !== "tv") return false;
      if (filter !== "all" && filter !== "movies" && filter !== "tv" && m.status !== filter) return false;
      if (!q) return true;
      return (
        m.title.toLowerCase().includes(q) ||
        (m.director ?? "").toLowerCase().includes(q)
      );
    });
  }, [movies, search, filter]);

  const sorted = useMemo(() => {
    const order: Record<MovieStatus, number> = { watching: 0, watchlist: 1, maybe: 2, seen: 3 };
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
              <span>Movies &amp; TV</span>
            </button>
            {editing ? (
              <div className={styles.editActions}>
                <button className={styles.removeBtn} onClick={() => removeMovie(selected.id)} disabled={saving}>Remove</button>
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
              <PosterImg src={selected.coverUrl ?? null} large type={selected.type} />
              <div className={styles.detailMeta}>
                <h2 className={styles.detailTitle}>{selected.title}</h2>
                <p className={styles.detailSub}>
                  {selected.type === "tv" ? "TV Series" : "Movie"}
                  {selected.director ? ` · ${selected.director}` : ""}
                </p>
                {selected.year && <p className={styles.detailYear}>{selected.year}</p>}
                {!editing && (
                  <span className={`${styles.badge} ${styles[`badge_${selected.status}`]}`}>
                    {STATUS_LABEL[selected.status]}
                  </span>
                )}
                {selected.streamingOn && selected.streamingOn.length > 0 && (
                  <div className={styles.streaming}>
                    {selected.streamingOn.map((s) => (
                      <span key={s} className={styles.streamPill}>{s}</span>
                    ))}
                  </div>
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
                    onChange={(e) => setEditStatus(e.target.value as MovieStatus)}
                  >
                    <option value="watching">Watching</option>
                    <option value="watchlist">Watchlist</option>
                    <option value="seen">Seen it</option>
                    <option value="maybe">Maybe</option>
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
                  Date watched
                  <input
                    className={styles.editInput}
                    type="text"
                    value={editDateWatched}
                    placeholder="e.g. 2024-03-15"
                    onChange={(e) => setEditDateWatched(e.target.value)}
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
                {selected.type === "tv" && (selected.currentSeason != null || selected.seasons != null) && (
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>Progress</span>
                    <p className={styles.fieldValue}>
                      {selected.currentSeason != null && selected.currentEpisode != null
                        ? `Season ${selected.currentSeason} · Episode ${selected.currentEpisode}`
                        : selected.seasons != null
                        ? `${selected.seasons} season${selected.seasons !== 1 ? "s" : ""}`
                        : ""}
                    </p>
                  </div>
                )}
                {selected.runtime && (
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>Runtime</span>
                    <p className={styles.fieldValue}>{selected.runtime}</p>
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
                {selected.dateWatched && (
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>Date watched</span>
                    <p className={styles.fieldValue}>{selected.dateWatched}</p>
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
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main list */}
      <div className={styles.header}>
        <div className={styles.headerRow}>
          <h1 className={styles.title}>Movies &amp; TV</h1>
          <div className={styles.headerActions}>
            {selectMode && (
              <button
                className={styles.selectBtn}
                onClick={() => {
                  if (selectedIds.size === sorted.length) {
                    setSelectedIds(new Set());
                  } else {
                    setSelectedIds(new Set(sorted.map((m) => m.id)));
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
          placeholder="Search titles, directors…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className={styles.filters}>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            className={`${styles.pill} ${filter === f.value ? styles.activePill : ""}`}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className={styles.list}>
        {loading && <p className={styles.empty}>Loading…</p>}
        {!loading && sorted.length === 0 && (
          <p className={styles.empty}>
            {movies.length === 0
              ? "No movies yet — ask Sonny to add one."
              : "No matches."}
          </p>
        )}
        {sorted.map((movie) => {
          const isChecked = selectedIds.has(movie.id);
          return (
            <button
              key={movie.id}
              className={`${styles.rowSelectable} ${isChecked ? styles.rowSelected : ""}`}
              onClick={() => selectMode ? toggleSelect(movie.id) : setSelected(movie)}
            >
              {selectMode && (
                <div className={`${styles.checkbox} ${isChecked ? styles.checkboxChecked : ""}`}>
                  {isChecked && <span className={styles.checkboxCheckmark}>✓</span>}
                </div>
              )}
              <PosterImg src={movie.coverUrl ?? null} type={movie.type} />
              <div className={styles.rowBody}>
                <p className={styles.rowTitle}>{movie.title}</p>
                <p className={styles.rowSub}>
                  {movie.type === "tv" ? "TV" : "Movie"}
                  {movie.director ? ` · ${movie.director}` : ""}
                </p>
                {(movie.year || progressLabel(movie)) && (
                  <p className={styles.rowMeta}>
                    {[movie.year, progressLabel(movie)].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
              <div className={styles.rowRight}>
                <span className={`${styles.badge} ${styles[`badge_${movie.status}`]}`}>
                  {STATUS_LABEL[movie.status]}
                </span>
                <Stars rating={movie.rating} />
              </div>
            </button>
          );
        })}
      </div>

      {selectMode && (
        <div className={styles.bulkBar}>
          <div className={styles.bulkRow}>
            <span className={styles.bulkCount}>{selectedIds.size} selected</span>
            <button
              className={styles.bulkRemove}
              onClick={removeBulkMovies}
              disabled={!selectedIds.size || bulkSaving}
            >
              Remove
            </button>
            <button
              className={styles.bulkApply}
              onClick={applyBulk}
              disabled={!selectedIds.size || bulkSaving || (bulkStatus === null && bulkRating === null && bulkDateWatched === null)}
            >
              {bulkSaving ? "Saving…" : "Apply"}
            </button>
          </div>
          <div className={styles.bulkFields}>
            {bulkStatus === null ? (
              <button className={styles.bulkChip} onClick={() => setBulkStatus("seen")}>+ Status</button>
            ) : (
              <div className={styles.bulkFieldActive}>
                <select
                  className={styles.bulkSelect}
                  value={bulkStatus}
                  onChange={(e) => setBulkStatus(e.target.value as MovieStatus)}
                >
                  <option value="seen">Seen it</option>
                  <option value="watching">Watching</option>
                  <option value="watchlist">Watchlist</option>
                  <option value="maybe">Maybe</option>
                </select>
                <button className={styles.bulkClear} onClick={() => setBulkStatus(null)}>×</button>
              </div>
            )}
            {bulkRating === null ? (
              <button className={styles.bulkChip} onClick={() => setBulkRating(5)}>+ Rating</button>
            ) : (
              <div className={styles.bulkFieldActive}>
                <select
                  className={styles.bulkSelect}
                  value={bulkRating}
                  onChange={(e) => setBulkRating(parseInt(e.target.value))}
                >
                  <option value="1">★ 1</option>
                  <option value="2">★★ 2</option>
                  <option value="3">★★★ 3</option>
                  <option value="4">★★★★ 4</option>
                  <option value="5">★★★★★ 5</option>
                </select>
                <button className={styles.bulkClear} onClick={() => setBulkRating(null)}>×</button>
              </div>
            )}
            {bulkDateWatched === null ? (
              <button className={styles.bulkChip} onClick={() => setBulkDateWatched("")}>+ Date watched</button>
            ) : (
              <div className={styles.bulkFieldActive}>
                <input
                  className={styles.bulkInput}
                  type="text"
                  value={bulkDateWatched}
                  placeholder="e.g. 2024-03-15"
                  onChange={(e) => setBulkDateWatched(e.target.value)}
                  autoFocus
                />
                <button className={styles.bulkClear} onClick={() => setBulkDateWatched(null)}>×</button>
              </div>
            )}
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
