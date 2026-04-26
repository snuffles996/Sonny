"use client";

import { useState, useMemo } from "react";
import type { Recipe } from "@/lib/recipes/types";
import styles from "./SwapMealModal.module.css";

interface Props {
  availableRecipes: Recipe[];
  onAdd: (slug: string) => void;
  onCancel: () => void;
}

export default function AddMealModal({ availableRecipes, onAdd, onCancel }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return availableRecipes;
    return availableRecipes.filter((r) => r.name.toLowerCase().includes(q) || r.cuisine?.toLowerCase().includes(q));
  }, [availableRecipes, search]);

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>Add a meal</div>

        <input
          className={styles.searchInput}
          type="search"
          placeholder="Search recipes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          autoComplete="off"
          autoFocus
        />

        <div className={styles.recipeList}>
          {filtered.length === 0 && <div className={styles.empty}>No recipes match.</div>}
          {filtered.map((r) => (
            <button
              key={r.slug}
              className={`${styles.recipeRow} ${selected === r.slug ? styles.selectedRow : ""}`}
              onClick={() => setSelected(r.slug)}
            >
              <span className={styles.rowName}>{r.name}</span>
              {r.cuisine && (
                <span className={`${styles.rowBadge} ${selected === r.slug ? styles.selected : ""}`}>
                  {r.cuisine}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className={styles.actions}>
          <button className={styles.cancel} onClick={onCancel}>Cancel</button>
          <button
            className={styles.confirm}
            disabled={!selected}
            onClick={() => selected && onAdd(selected)}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
