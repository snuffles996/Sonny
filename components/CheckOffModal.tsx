"use client";

import { useState } from "react";
import type { PlannedMeal } from "@/lib/mealplan/types";
import styles from "./CheckOffModal.module.css";

interface Props {
  meal: PlannedMeal;
  onConfirm: (notes?: string) => void;
  onCancel: () => void;
}

export default function CheckOffModal({ meal, onConfirm, onCancel }: Props) {
  const [notes, setNotes] = useState(meal.notes ?? "");

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>Mark as made?</div>
        <div className={styles.recipeName}>{meal.recipeName}</div>
        <textarea
          className={styles.notes}
          placeholder="Any notes or tweaks? (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
        />
        <div className={styles.actions}>
          <button className={styles.cancel} onClick={onCancel}>Cancel</button>
          <button className={styles.confirm} onClick={() => onConfirm(notes || undefined)}>
            Mark made
          </button>
        </div>
      </div>
    </div>
  );
}
