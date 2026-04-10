"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import BottomNav from "@/components/BottomNav";
import MealPlanCard from "@/components/MealPlanCard";
import CheckOffModal from "@/components/CheckOffModal";
import GroceryList from "@/components/GroceryList";
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

  const [groceryItems, setGroceryItems] = useState<GroceryItem[] | null>(null);
  const [buildingGrocery, setBuildingGrocery] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState<{ existingCount: number; listName: string } | null>(null);

  const [checkOffMeal, setCheckOffMeal] = useState<PlannedMeal | null>(null);

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
    ])
      .then(([planData, recipeData]) => {
        setPlan(planData.plan ?? null);
        setRecipes(recipeData.recipes ?? []);
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

  async function handleBuildGrocery() {
    if (!token) return;
    setBuildingGrocery(true);
    const res = await fetch("/api/mealplan/grocery", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.items) setGroceryItems(data.items);
    setBuildingGrocery(false);
  }

  async function handleSendToReminders(replace = false) {
    if (!token || !groceryItems) return;
    setSending(true);
    setConfirmReplace(null);
    const res = await fetch("/api/mealplan/grocery", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ replace }),
    });
    const data = await res.json();
    if (data.existingCount > 0 && !replace) {
      setConfirmReplace({ existingCount: data.existingCount, listName: data.listName });
    } else if (data.added !== undefined) {
      setPlan((p) => (p ? { ...p, groceryListSent: true } : p));
    }
    setSending(false);
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

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Meal Plan</h1>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === "meals" ? styles.activeTab : ""}`}
            onClick={() => setTab("meals")}
          >
            Meals
          </button>
          <button
            className={`${styles.tab} ${tab === "shopping" ? styles.activeTab : ""}`}
            onClick={() => setTab("shopping")}
          >
            Shopping
          </button>
        </div>
      </div>

      <div className={styles.content}>
        {tab === "meals" && (
          !plan || plan.meals.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyText}>No meal plan yet.</p>
              <button className={styles.emptyAction} onClick={() => router.push("/chat")}>
                Plan meals in Chat
              </button>
            </div>
          ) : (
            <div className={styles.mealList}>
              {plan.meals.map((meal) => (
                <MealPlanCard
                  key={meal.recipeSlug}
                  meal={meal}
                  recipe={recipeMap.get(meal.recipeSlug)}
                  onCheckOff={handleCheckOff}
                  onTapRecipe={() => router.push("/recipes")}
                />
              ))}
            </div>
          )
        )}

        {tab === "shopping" && (
          !plan || plan.meals.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyText}>Plan your meals first.</p>
              <button className={styles.emptyAction} onClick={() => setTab("meals")}>
                Go to Meals
              </button>
            </div>
          ) : !groceryItems ? (
            <div className={styles.buildPrompt}>
              <p className={styles.buildText}>
                {plan.groceryListSent
                  ? "Grocery list was already sent to Reminders."
                  : "Ready to build your shopping list."}
              </p>
              <button
                className={styles.buildButton}
                onClick={handleBuildGrocery}
                disabled={buildingGrocery}
              >
                {buildingGrocery ? "Building…" : "Build Grocery List"}
              </button>
            </div>
          ) : (
            <div className={styles.groceryWrap}>
              {plan.groceryListSent && !confirmReplace && (
                <p className={styles.sentBadge}>Sent to Reminders</p>
              )}
              {confirmReplace && (
                <div className={styles.confirmBanner}>
                  &ldquo;{confirmReplace.listName}&rdquo; already has {confirmReplace.existingCount} items. Replace them?
                  <div className={styles.confirmActions}>
                    <button className={styles.confirmBtn} onClick={() => setConfirmReplace(null)}>
                      Cancel
                    </button>
                    <button
                      className={`${styles.confirmBtn} ${styles.primary}`}
                      onClick={() => handleSendToReminders(true)}
                    >
                      Replace
                    </button>
                  </div>
                </div>
              )}
              <GroceryList
                items={groceryItems}
                onSendToReminders={() => handleSendToReminders(false)}
                sending={sending}
              />
            </div>
          )
        )}
      </div>

      <BottomNav />

      {checkOffMeal && (
        <CheckOffModal
          meal={checkOffMeal}
          onConfirm={confirmCheckOff}
          onCancel={() => setCheckOffMeal(null)}
        />
      )}
    </div>
  );
}
