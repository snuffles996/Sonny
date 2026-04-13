"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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

  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) { router.replace("/chat"); return; }
    setToken(t);
  }, [router]);

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
            <button className={styles.backBtn} onClick={() => setSelected(null)}>
              <ArrowLeft size={18} />
              <span>Movies &amp; TV</span>
            </button>
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
                <span className={`${styles.badge} ${styles[`badge_${selected.status}`]}`}>
                  {STATUS_LABEL[selected.status]}
                </span>
                {selected.streamingOn && selected.streamingOn.length > 0 && (
                  <div className={styles.streaming}>
                    {selected.streamingOn.map((s) => (
                      <span key={s} className={styles.streamPill}>{s}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>

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
          </div>
        </div>
      )}

      {/* Main list */}
      <div className={styles.header}>
        <h1 className={styles.title}>Movies &amp; TV</h1>
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
        {sorted.map((movie) => (
          <button
            key={movie.id}
            className={styles.row}
            onClick={() => setSelected(movie)}
          >
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
        ))}
      </div>

      <BottomNav />
    </div>
  );
}
