"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import BottomNav from "@/components/BottomNav";
import type { Recipe, RecipeMealType } from "@/lib/recipes/types";
import styles from "./recipes.module.css";

const TOKEN_KEY = "sonny_token";
const ALL = "All";

interface RecipeForm {
  name: string;
  cuisine: string;
  source: string;
  servings: string;
  totalTime: string;
  notes: string;
  ingredients: string;
  instructions: string;
  mealType: RecipeMealType;
}

const EMPTY_FORM: RecipeForm = {
  name: "", cuisine: "", source: "", servings: "", totalTime: "",
  notes: "", ingredients: "", instructions: "", mealType: "dinner",
};

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

  // Manual entry / edit form
  const [showForm, setShowForm] = useState(false);
  const [editingSlug, setEditingSlug] = useState<string | null>(null); // null = new recipe
  const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | null>(null);
  const [form, setForm] = useState<RecipeForm>(EMPTY_FORM);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) { router.replace("/chat"); return; }
    setToken(t);
  }, [router]);

  useEffect(() => {
    if (!token) return;
    fetch("/api/recipes", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (r.status === 401) { localStorage.removeItem(TOKEN_KEY); router.replace("/chat"); return null; }
        return r.json();
      })
      .then((data) => { if (data?.recipes) setRecipes(data.recipes); })
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

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));
    setUploadError(null);
  }

  function openNewForm() {
    setEditingSlug(null);
    setExistingPhotoUrl(null);
    setForm(EMPTY_FORM);
    setPhotoFile(null);
    setPhotoPreviewUrl(null);
    setUploadError(null);
    setShowForm(true);
  }

  function openEditForm(recipe: Recipe) {
    // Parse ## Ingredients / ## Instructions back out of the content markdown.
    // Use \n+ to handle both single and double newlines from URL-extracted recipes.
    const ingrMatch = recipe.content.match(/##\s*Ingredients\s*\n+([\s\S]*?)(?=\n+##|$)/i);
    const instrMatch = recipe.content.match(/##\s*Instructions\s*\n+([\s\S]*?)(?=\n+##|$)/i);
    setEditingSlug(recipe.slug);
    setExistingPhotoUrl(recipe.photoUrl ?? null);
    setForm({
      name: recipe.name,
      cuisine: recipe.cuisine,
      source: recipe.source === "manual" ? "" : recipe.source,
      servings: recipe.servings != null ? String(recipe.servings) : "",
      totalTime: recipe.totalTime ?? "",
      notes: recipe.notes ?? "",
      ingredients: ingrMatch?.[1]?.trim() ?? "",
      instructions: instrMatch?.[1]?.trim() ?? "",
      mealType: recipe.mealType ?? "dinner",
    });
    setPhotoFile(null);
    setPhotoPreviewUrl(null);
    setUploadError(null);
    setShowForm(true);
  }

  function resetForm() {
    setEditingSlug(null);
    setExistingPhotoUrl(null);
    setForm(EMPTY_FORM);
    setPhotoFile(null);
    setPhotoPreviewUrl(null);
    setUploadError(null);
    setShowForm(false);
  }

  async function handleSaveRecipe() {
    if (!token || !form.name.trim() || !form.cuisine.trim()) return;
    if (!form.ingredients.trim() && !form.instructions.trim()) return;
    setSaving(true);
    setUploadError(null);

    try {
      // Determine the final photo URL: new upload > existing > none
      let photoUrl: string | undefined = existingPhotoUrl ?? undefined;

      if (photoFile) {
        const fd = new FormData();
        fd.append("photo", photoFile);
        const uploadRes = await fetch("/api/recipes/upload-photo", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          photoUrl = uploadData.url;
        } else {
          const errData = await uploadRes.json().catch(() => ({}));
          setUploadError(errData.error ?? "Photo upload failed. Fix the issue or remove the photo and try again.");
          return; // Stop — don't save without the photo the user explicitly attached
        }
      }

      const content = [
        form.ingredients.trim() ? `## Ingredients\n\n${form.ingredients.trim()}` : "",
        form.instructions.trim() ? `## Instructions\n\n${form.instructions.trim()}` : "",
      ].filter(Boolean).join("\n\n");

      // Derive slug: keep existing slug when editing, generate new one otherwise
      const slug = editingSlug ?? form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

      const res = await fetch("/api/recipes/add", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          recipe: {
            slug,
            name: form.name.trim(),
            cuisine: form.cuisine.trim(),
            source: form.source.trim() || "manual",
            content,
            mealType: form.mealType,
            ...(form.servings && { servings: parseInt(form.servings, 10) }),
            ...(form.totalTime.trim() && { totalTime: form.totalTime.trim() }),
            ...(form.notes.trim() && { notes: form.notes.trim() }),
            ...(photoUrl && { photoUrl }),
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setRecipes((prev) => {
          const idx = prev.findIndex((r) => r.slug === data.recipe.slug);
          if (idx >= 0) { const next = [...prev]; next[idx] = data.recipe; return next; }
          return [...prev, data.recipe];
        });
        // If editing the currently selected recipe, update it in the detail sheet too
        if (editingSlug) setSelected(data.recipe);
        resetForm();
      }
    } finally {
      setSaving(false);
    }
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
        <div className={styles.titleRow}>
          <h1 className={styles.title}>All Meals</h1>
          <button className={styles.addRecipeBtn} onClick={openNewForm}>+ Add recipe</button>
        </div>
        <input
          className={styles.search}
          type="search"
          placeholder="Search by name or ingredient…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        />
      </div>

      <div className={styles.filters}>
        {cuisines.map((c) => (
          <button key={c} className={`${styles.pill} ${cuisine === c ? styles.activePill : ""}`} onClick={() => setCuisine(c)}>
            {c}
          </button>
        ))}
      </div>

      <div className={styles.filters}>
        {sources.map((s) => (
          <button key={s} className={`${styles.pill} ${source === s ? styles.activePill : ""}`} onClick={() => setSource(s)}>
            {s}
          </button>
        ))}
      </div>

      <div className={styles.list}>
        <p className={styles.count}>{filtered.length} recipes</p>
        {filtered.length === 0 && <p className={styles.empty}>No recipes match.</p>}
        {filtered.map((r) => (
          <div key={r.slug} className={styles.card} onClick={() => setSelected(r)}>
            <span className={styles.cardName}>{r.name}</span>
            <span className={styles.badge}>{r.cuisine}</span>
          </div>
        ))}
      </div>

      <BottomNav />

      {/* ── Recipe detail sheet ── */}
      {selected && (
        <div className={styles.overlay} onClick={() => { setSelected(null); setConfirmRemove(false); }}>
          <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
            <div className={styles.sheetHeader}>
              <h2 className={styles.sheetTitle}>{selected.name}</h2>
              <div className={styles.sheetHeaderActions}>
                {confirmRemove ? (
                  <>
                    <button className={styles.confirmRemoveBtn} onClick={() => handleRemoveRecipe(selected.slug)} disabled={removing}>
                      {removing ? "…" : "Confirm"}
                    </button>
                    <button className={styles.cancelRemoveBtn} onClick={() => setConfirmRemove(false)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button className={styles.editRecipeBtn} onClick={() => { setConfirmRemove(false); openEditForm(selected); }}>Edit</button>
                    <button className={styles.removeRecipeBtn} onClick={() => setConfirmRemove(true)}>Remove</button>
                  </>
                )}
                <button className={styles.closeBtn} onClick={() => { setSelected(null); setConfirmRemove(false); }}>✕</button>
              </div>
            </div>
            <div className={styles.sheetMeta}>
              <span className={styles.badge}>{selected.cuisine}</span>
              {selected.totalTime && <span className={styles.badge}>{selected.totalTime}</span>}
              {selected.servings && <span className={styles.badge}>Serves {selected.servings}</span>}
              {selected.lastMade && <span className={styles.badge}>Made {selected.lastMade}</span>}
              {selected.url && (
                <a href={selected.url} target="_blank" rel="noopener noreferrer" className={styles.sourceLink} onClick={(e) => e.stopPropagation()}>
                  {selected.source} ↗
                </a>
              )}
            </div>
            <div className={styles.sheetBody}>
              {selected.photoUrl && (
                <img src={selected.photoUrl} alt={selected.name} className={styles.sheetPhoto} />
              )}
              {selected.notes && <div className={styles.sheetNotes}>{selected.notes}</div>}
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.content}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}

      {/* ── Manual entry form ── */}
      {showForm && (
        <div className={styles.formOverlay} onClick={resetForm}>
          <div className={styles.formSheet} onClick={(e) => e.stopPropagation()}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle}>{editingSlug ? "Edit recipe" : "Add recipe"}</span>
              <button className={styles.closeBtn} onClick={resetForm}>✕</button>
            </div>

            <div className={styles.formBody}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Name *</label>
                <input className={styles.formInput} placeholder="e.g. Chicken Tikka Masala" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Meal type</label>
                <div className={styles.mealTypePicker}>
                  {(["breakfast", "lunch", "dinner", "snack", "dessert"] as RecipeMealType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`${styles.mealTypePill} ${form.mealType === t ? styles.mealTypeActive : ""}`}
                      onClick={() => setForm({ ...form, mealType: t })}
                    >
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Cuisine *</label>
                  <input className={styles.formInput} placeholder="e.g. Indian" value={form.cuisine} onChange={(e) => setForm({ ...form, cuisine: e.target.value })} />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Source</label>
                  <input className={styles.formInput} placeholder="e.g. cookbook, photo" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
                </div>
              </div>

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Servings</label>
                  <input className={styles.formInput} type="number" placeholder="4" value={form.servings} onChange={(e) => setForm({ ...form, servings: e.target.value })} />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Total time</label>
                  <input className={styles.formInput} placeholder="45 minutes" value={form.totalTime} onChange={(e) => setForm({ ...form, totalTime: e.target.value })} />
                </div>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Ingredients *</label>
                <textarea className={styles.formTextarea} rows={5} placeholder={"- 2 cups flour\n- 1 tsp salt\n- ..."} value={form.ingredients} onChange={(e) => setForm({ ...form, ingredients: e.target.value })} />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Instructions *</label>
                <textarea className={styles.formTextarea} rows={6} placeholder={"1. Preheat oven to 350°F\n2. Mix dry ingredients\n..."} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Notes</label>
                <input className={styles.formInput} placeholder="Tips, variations…" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Photo</label>
                <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhotoChange} />
                <div className={styles.photoRow}>
                  <button className={styles.photoUploadBtn} onClick={() => fileInputRef.current?.click()}>
                    {photoFile ? photoFile.name : existingPhotoUrl ? "Replace photo…" : "Choose photo…"}
                  </button>
                  {(photoFile || existingPhotoUrl) && (
                    <button
                      className={styles.removePhotoBtn}
                      onClick={() => {
                        setPhotoFile(null);
                        setPhotoPreviewUrl(null);
                        setExistingPhotoUrl(null);
                        setUploadError(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
                {photoPreviewUrl
                  ? <img src={photoPreviewUrl} alt="new photo preview" className={styles.photoPreview} />
                  : existingPhotoUrl
                  ? <img src={existingPhotoUrl} alt="existing photo" className={styles.photoPreview} />
                  : null}
              </div>
            </div>

            {uploadError && (
              <div className={styles.uploadError}>{uploadError}</div>
            )}
            <div className={styles.formActions}>
              <button className={styles.formCancelBtn} onClick={resetForm}>Cancel</button>
              <button
                className={styles.formSubmitBtn}
                onClick={handleSaveRecipe}
                disabled={saving || !form.name.trim() || !form.cuisine.trim() || (!form.ingredients.trim() && !form.instructions.trim())}
              >
                {saving ? "Saving…" : "Save recipe"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
