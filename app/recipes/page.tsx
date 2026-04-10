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
  const [selected, setSelected] = useState<Recipe | null>(null);

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

  const filtered = useMemo(() => {
    return recipes.filter((r) => {
      const matchesCuisine = cuisine === ALL || r.cuisine === cuisine;
      const matchesSearch =
        !search ||
        r.name.toLowerCase().includes(search.toLowerCase());
      return matchesCuisine && matchesSearch;
    });
  }, [recipes, cuisine, search]);

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
          placeholder="Search recipes…"
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
        <div className={styles.overlay} onClick={() => setSelected(null)}>
          <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
            <div className={styles.sheetHeader}>
              <h2 className={styles.sheetTitle}>{selected.name}</h2>
              <button className={styles.closeBtn} onClick={() => setSelected(null)}>
                ✕
              </button>
            </div>
            <div className={styles.sheetMeta}>
              <span className={styles.badge}>{selected.cuisine}</span>
              {selected.totalTime && (
                <span className={styles.badge}>{selected.totalTime}</span>
              )}
              {selected.servings && (
                <span className={styles.badge}>Serves {selected.servings}</span>
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
