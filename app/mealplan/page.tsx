"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import BottomNav from "@/components/BottomNav";
import MealPlanCard from "@/components/MealPlanCard";
import CheckOffModal from "@/components/CheckOffModal";
import GroceryList from "@/components/GroceryList";
import PlanMealsModal from "@/components/PlanMealsModal";
import SwapMealModal from "@/components/SwapMealModal";
import AddMealModal from "@/components/AddMealModal";
import PantryExclusions from "@/components/PantryExclusions";
import type { MealPlan, PlannedMeal } from "@/lib/mealplan/types";
import type { Recipe } from "@/lib/recipes/types";
import type { GroceryItem } from "@/lib/mealplan/grocery";
import styles from "./mealplan.module.css";

const TOKEN_KEY = "sonny_token";
type Tab = "meals" | "shopping";

export default function MealPlanPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("meals");
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);

  // Recipe detail sheet
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);

  // Grocery
  const [groceryItems, setGroceryItems] = useState<GroceryItem[] | null>(null);
  const [checkedItems, setCheckedItems] = useState<string[]>([]);
  const [rebuilding, setRebuilding] = useState(false);

  // Pantry exclusions
  const [exclusions, setExclusions] = useState<string[]>([]);

  // Modals
  const [checkOffMeal, setCheckOffMeal] = useState<PlannedMeal | null>(null);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [swapMeal, setSwapMeal] = useState<PlannedMeal | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showAddMealModal, setShowAddMealModal] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) { router.replace("/chat"); return; }
    setToken(t);
  }, [router]);

  useEffect(() => {
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch("/api/mealplan", { headers }).then((r) => r.json()),
      fetch("/api/recipes", { headers }).then((r) => r.json()),
      fetch("/api/mealplan/exclusions", { headers }).then((r) => r.json()),
      fetch("/api/mealplan/grocery", { headers }).then((r) => r.json()),
    ])
      .then(([planData, recipeData, exclusionData, groceryData]) => {
        setPlan(planData.plan ?? null);
        setRecipes(recipeData.recipes ?? []);
        setExclusions(exclusionData.exclusions ?? []);
        if (groceryData.items) {
          setGroceryItems(groceryData.items);
          setCheckedItems(groceryData.checkedItems ?? []);
        }
      })
      .finally(() => setLoading(false));
  }, [token]);

  async function handleCheckOff(slug: string) {
    const meal = plan?.meals.find((m) => m.recipeSlug === slug);
    if (!meal || meal.made) return;
    setCheckOffMeal(meal);
  }

  async function confirmCheckOff(notes?: string) {
    if (!checkOffMeal || !token) return;
    const res = await fetch("/api/mealplan", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ slug: checkOffMeal.recipeSlug, made: true, notes }),
    });
    const data = await res.json();
    if (data.plan) setPlan(data.plan);
    setCheckOffMeal(null);
  }

  async function handleServingsChange(slug: string, servings: number) {
    if (!token) return;
    const res = await fetch("/api/mealplan", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ slug, servings }),
    });
    const data = await res.json();
    if (data.plan) setPlan(data.plan);
  }

  async function handleSwap(slug: string, replacementSlug: string) {
    if (!token) return;
    const res = await fetch("/api/mealplan", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ slug, replacementSlug }),
    });
    const data = await res.json();
    if (data.plan) setPlan(data.plan);
    setSwapMeal(null);
    // Grocery list is stale after a swap — clear it so it rebuilds
    setGroceryItems(null);
    setCheckedItems([]);
  }

  async function handleRemoveMeal(slug: string) {
    if (!token) return;
    const res = await fetch("/api/mealplan", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ removeMealSlug: slug }),
    });
    const data = await res.json();
    if (data.plan) setPlan(data.plan);
    setGroceryItems(null);
    setCheckedItems([]);
  }

  async function handleAddMeal(slug: string) {
    if (!token) return;
    const res = await fetch("/api/mealplan", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ addSlug: slug }),
    });
    const data = await res.json();
    if (data.plan) setPlan(data.plan);
    setShowAddMealModal(false);
    setGroceryItems(null);
    setCheckedItems([]);
  }

  async function handleClear() {
    if (!token) return;
    await fetch("/api/mealplan", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    setPlan(null);
    setGroceryItems(null);
    setCheckedItems([]);
    setConfirmClear(false);
  }

  async function handleToggleItem(itemName: string) {
    if (!token) return;
    const res = await fetch("/api/mealplan/grocery", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ itemName }),
    });
    const data = await res.json();
    if (data.checkedItems) setCheckedItems(data.checkedItems);
  }

  async function handleRebuild() {
    if (!token) return;
    setRebuilding(true);
    // Clear the cache, then re-fetch (GET will rebuild)
    await fetch("/api/mealplan/grocery", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await fetch("/api/mealplan/grocery", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.items) {
      setGroceryItems(data.items);
      setCheckedItems(data.checkedItems ?? []);
    }
    setRebuilding(false);
  }

  async function handleAddExclusion(name: string) {
    if (!token) return;
    const res = await fetch("/api/mealplan/exclusions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (data.exclusions) setExclusions(data.exclusions);
  }

  async function handleRemoveExclusion(name: string) {
    if (!token) return;
    const res = await fetch("/api/mealplan/exclusions", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (data.exclusions) setExclusions(data.exclusions);
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>Loading…</div>
        <BottomNav />
      </div>
    );
  }

  const recipeMap = new Map(recipes.map((r) => [r.slug, r]));
  const planSlugs = new Set(plan?.meals.map((m) => m.recipeSlug) ?? []);
  const swappableRecipes = recipes.filter((r) => !planSlugs.has(r.slug));

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Meal Plan</h1>
        <div className={styles.tabs}>
          <button className={`${styles.tab} ${tab === "meals" ? styles.activeTab : ""}`} onClick={() => setTab("meals")}>
            Meals
          </button>
          <button className={`${styles.tab} ${tab === "shopping" ? styles.activeTab : ""}`} onClick={() => setTab("shopping")}>
            Shopping
          </button>
        </div>
      </div>

      <div className={styles.content}>
        {/* ── Meals tab ── */}
        {tab === "meals" && (
          !plan || plan.meals.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyText}>No meal plan yet.</p>
              <button className={styles.emptyAction} onClick={() => setShowPlanModal(true)}>
                Plan meals
              </button>
            </div>
          ) : (
            <>
              {confirmClear ? (
                <div className={styles.confirmBanner}>
                  Clear all {plan.meals.length} meals?
                  <div className={styles.confirmActions}>
                    <button className={styles.confirmBtn} onClick={() => setConfirmClear(false)}>Cancel</button>
                    <button className={`${styles.confirmBtn} ${styles.destructive}`} onClick={handleClear}>Yes, clear</button>
                  </div>
                </div>
              ) : (
                <div className={styles.mealsHeader}>
                  <button className={styles.addMoreBtn} onClick={() => setShowAddMealModal(true)}>+ Add meal</button>
                  <button className={styles.addMoreBtn} onClick={() => setShowPlanModal(true)}>New plan</button>
                  <button className={styles.clearBtn} onClick={() => setConfirmClear(true)}>Clear</button>
                </div>
              )}
              <div className={styles.mealList}>
                {plan.meals.map((meal) => (
                  <MealPlanCard
                    key={meal.recipeSlug}
                    meal={meal}
                    recipe={recipeMap.get(meal.recipeSlug)}
                    planServings={plan.servings}
                    onCheckOff={handleCheckOff}
                    onTapRecipe={(slug) => setSelectedRecipe(recipeMap.get(slug) ?? null)}
                    onServingsChange={handleServingsChange}
                    onSwap={(slug) => setSwapMeal(plan.meals.find((m) => m.recipeSlug === slug) ?? null)}
                    onRemove={handleRemoveMeal}
                  />
                ))}
              </div>
            </>
          )
        )}

        {/* ── Shopping tab ── */}
        {tab === "shopping" && (
          !plan || plan.meals.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyText}>Plan your meals first.</p>
              <button className={styles.emptyAction} onClick={() => setTab("meals")}>Go to Meals</button>
            </div>
          ) : !groceryItems ? (
            <div className={styles.buildPrompt}>
              <p className={styles.buildText}>Ready to build your shopping list.</p>
              <button className={styles.buildButton} onClick={handleRebuild} disabled={rebuilding}>
                {rebuilding ? "Building…" : "Build Shopping List"}
              </button>
            </div>
          ) : (
            <div className={styles.groceryWrap}>
              <GroceryList
                items={groceryItems}
                checkedItems={checkedItems}
                onToggleItem={handleToggleItem}
                onRebuild={handleRebuild}
                rebuilding={rebuilding}
              />
              <PantryExclusions
                exclusions={exclusions}
                onAdd={handleAddExclusion}
                onRemove={handleRemoveExclusion}
              />
            </div>
          )
        )}
      </div>

      <BottomNav />

      {/* ── Overlays ── */}
      {checkOffMeal && (
        <CheckOffModal meal={checkOffMeal} onConfirm={confirmCheckOff} onCancel={() => setCheckOffMeal(null)} />
      )}
      {showPlanModal && token && (
        <PlanMealsModal
          token={token}
          onClose={() => setShowPlanModal(false)}
          onGenerated={(newPlan) => { setPlan(newPlan); setShowPlanModal(false); setGroceryItems(null); setCheckedItems([]); }}
        />
      )}
      {swapMeal && (
        <SwapMealModal
          meal={swapMeal}
          availableRecipes={swappableRecipes}
          onSwap={handleSwap}
          onCancel={() => setSwapMeal(null)}
        />
      )}
      {showAddMealModal && (
        <AddMealModal
          availableRecipes={swappableRecipes}
          onAdd={handleAddMeal}
          onCancel={() => setShowAddMealModal(false)}
        />
      )}

      {/* ── Recipe detail sheet ── */}
      {selectedRecipe && (
        <div className={styles.overlay} onClick={() => setSelectedRecipe(null)}>
          <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
            <div className={styles.sheetHeader}>
              <h2 className={styles.sheetTitle}>{selectedRecipe.name}</h2>
              <button className={styles.closeBtn} onClick={() => setSelectedRecipe(null)}>✕</button>
            </div>
            <div className={styles.sheetMeta}>
              {selectedRecipe.cuisine && <span className={styles.sheetBadge}>{selectedRecipe.cuisine}</span>}
              {selectedRecipe.totalTime && <span className={styles.sheetBadge}>{selectedRecipe.totalTime}</span>}
              {selectedRecipe.servings && <span className={styles.sheetBadge}>Serves {selectedRecipe.servings}</span>}
              {selectedRecipe.lastMade && <span className={styles.sheetBadge}>Made {selectedRecipe.lastMade}</span>}
              {selectedRecipe.url && (
                <a href={selectedRecipe.url} target="_blank" rel="noopener noreferrer" className={styles.sourceLink} onClick={(e) => e.stopPropagation()}>
                  {selectedRecipe.source} ↗
                </a>
              )}
            </div>
            <div className={styles.sheetBody}>
              {selectedRecipe.notes && <div className={styles.sheetNotes}>{selectedRecipe.notes}</div>}
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedRecipe.content}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
