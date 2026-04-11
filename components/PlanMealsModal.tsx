"use client";

import { useState } from "react";
import type { MealPlan } from "@/lib/mealplan/types";
import styles from "./PlanMealsModal.module.css";

interface Props {
  token: string;
  onClose: () => void;
  onGenerated: (plan: MealPlan) => void;
}

export default function PlanMealsModal({ token, onClose, onGenerated }: Props) {
  const [count, setCount] = useState(4);
  const [servings, setServings] = useState(2);
  const [preferences, setPreferences] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/mealplan/generate", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ count, servings, preferences }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Try again.");
        return;
      }
      onGenerated(data.plan);
    } catch {
      setError("Connection error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>Plan your meals</div>

        <div className={styles.stepperRow}>
          <span className={styles.stepperLabel}>Meals</span>
          <div className={styles.stepperControls}>
            <button className={styles.stepperBtn} onClick={() => setCount((c) => Math.max(1, c - 1))} disabled={count <= 1}>−</button>
            <span className={styles.stepperValue}>{count}</span>
            <button className={styles.stepperBtn} onClick={() => setCount((c) => Math.min(7, c + 1))} disabled={count >= 7}>+</button>
          </div>
        </div>

        <div className={styles.stepperRow}>
          <span className={styles.stepperLabel}>Servings each</span>
          <div className={styles.stepperControls}>
            <button className={styles.stepperBtn} onClick={() => setServings((s) => Math.max(1, s - 1))} disabled={servings <= 1}>−</button>
            <span className={styles.stepperValue}>{servings}</span>
            <button className={styles.stepperBtn} onClick={() => setServings((s) => Math.min(10, s + 1))} disabled={servings >= 10}>+</button>
          </div>
        </div>

        <textarea
          className={styles.preferences}
          placeholder="Any preferences? e.g. nothing spicy, more Asian food…"
          value={preferences}
          onChange={(e) => setPreferences(e.target.value)}
          rows={2}
        />

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.actions}>
          <button className={styles.cancel} onClick={onClose}>Cancel</button>
          <button className={styles.confirm} onClick={handleSubmit} disabled={loading}>
            {loading ? "Planning…" : "Generate Plan"}
          </button>
        </div>
      </div>
    </div>
  );
}
