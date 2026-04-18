"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import BottomNav from "@/components/BottomNav";
import type { Recipe } from "@/lib/recipes/types";
import styles from "./recipes.module.css";

const TOKEN_KEY = "sonny_token";

const ALL = "All";

export default function RecipesPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [cuisine, setCuisine] = useState(ALL);
  const [source, setSource] = useState(ALL);
  const [selected, setSelected] = useState<Recipe | null>(null);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Auth check
  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) {
      router.replace("/chat");
      return;
    }
    setToken(t);
  }, [router]);

  // Fetch recipes once we have a token
  useEffect(() => {
    if (!token) return;
    fetch("/api/recipes", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (r.status === 401) {
          localStorage.removeItem(TOKEN_KEY);
          router.replace("/chat");
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data?.recipes) setRecipes(data.recipes);
      })
      .finally(() => setLoading(false));
  }, [token, router]);

  const cuisines = useMemo(() => {
    const set = new Set(recipes.map((r) => r.cuisine).filter(Boolean));
    return [ALL, ...Array.from(set).sort()];
  }, [recipes]);

  const sources = useMemo(() => {
    const set = new Set(recipes.map((r) => r.source).filter(Boolean));
    return [ALL, ...Array.from(set).sort()];
  }, [recipes]);

  // Parse query into tokens: "quoted phrase" stays whole, bare words split individually.
  // All tokens must match (AND logic).
  function matchesQuery(recipe: Recipe, query: string): boolean {
    if (!query.trim()) return true;
    const haystack = `${recipe.name} ${recipe.content}`.toLowerCase();
    const tokens: string[] = [];
    const re = /"([^"]+)"|(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(query)) !== null) tokens.push((m[1] ?? m[2]).toLowerCase());
    return tokens.every((t) => haystack.includes(t));
  }

  const filtered = useMemo(() => {
    return recipes.filter((r) => {
      const matchesCuisine = cuisine === ALL || r.cuisine === cuisine;
      const matchesSource = source === ALL || r.source === source;
      return matchesCuisine && matchesSource && matchesQuery(r, search);
    });
  }, [recipes, cuisine, source, search]);

  async function handleRemoveRecipe(slug: string) {
    if (!token || removing) return;
    setRemoving(true);
    await fetch(`/api/recipes?slug=${encodeURIComponent(slug)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    setRecipes((prev) => prev.filter((r) => r.slug !== slug));
    setSelected(null);
    setRemoving(false);
    setConfirmRemove(false);
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>Loading recipes…</div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>All Meals</h1>
        <input
          className={styles.search}
          type="search"
          placeholder="Search by name or ingredient…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className={styles.filters}>
        {cuisines.map((c) => (
          <button
            key={c}
            className={`${styles.pill} ${cuisine === c ? styles.activePill : ""}`}
            onClick={() => setCuisine(c)}
          >
            {c}
          </button>
        ))}
      </div>

      <div className={styles.filters}>
        {sources.map((s) => (
          <button
            key={s}
            className={`${styles.pill} ${source === s ? styles.activePill : ""}`}
            onClick={() => setSource(s)}
          >
            {s}
          </button>
        ))}
      </div>

      <div className={styles.list}>
        <p className={styles.count}>{filtered.length} recipes</p>
        {filtered.length === 0 && (
          <p className={styles.empty}>No recipes match.</p>
        )}
        {filtered.map((r) => (
          <div key={r.slug} className={styles.card} onClick={() => setSelected(r)}>
            <span className={styles.cardName}>{r.name}</span>
            <span className={styles.badge}>{r.cuisine}</span>
          </div>
        ))}
      </div>

      <BottomNav />

      {selected && (
        <div className={styles.overlay} onClick={() => { setSelected(null); setConfirmRemove(false); }}>
          <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
            <div className={styles.sheetHeader}>
              <h2 className={styles.sheetTitle}>{selected.name}</h2>
              <div className={styles.sheetHeaderActions}>
                {confirmRemove ? (
                  <>
                    <button
                      className={styles.confirmRemoveBtn}
                      onClick={() => handleRemoveRecipe(selected.slug)}
                      disabled={removing}
                    >
                      {removing ? "…" : "Confirm"}
                    </button>
                    <button className={styles.cancelRemoveBtn} onClick={() => setConfirmRemove(false)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    className={styles.removeRecipeBtn}
                    onClick={() => setConfirmRemove(true)}
                  >
                    Remove
                  </button>
                )}
                <button className={styles.closeBtn} onClick={() => { setSelected(null); setConfirmRemove(false); }}>
                  ✕
                </button>
              </div>
            </div>
            <div className={styles.sheetMeta}>
              <span className={styles.badge}>{selected.cuisine}</span>
              {selected.totalTime && (
                <span className={styles.badge}>{selected.totalTime}</span>
              )}
              {selected.servings && (
                <span className={styles.badge}>Serves {selected.servings}</span>
              )}
              {selected.lastMade && (
                <span className={styles.badge}>Made {selected.lastMade}</span>
              )}
              {selected.url && (
                <a
                  href={selected.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.sourceLink}
                  onClick={(e) => e.stopPropagation()}
                >
                  {selected.source} ↗
                </a>
              )}
            </div>
            <div className={styles.sheetBody}>
              {selected.notes && (
                <div className={styles.sheetNotes}>
                  {selected.notes}
                </div>
              )}
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {selected.content}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
