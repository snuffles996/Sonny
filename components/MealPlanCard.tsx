"use client";

import type { PlannedMeal } from "@/lib/mealplan/types";
import type { Recipe } from "@/lib/recipes/types";
import styles from "./MealPlanCard.module.css";

interface Props {
  meal: PlannedMeal;
  recipe?: Recipe;
  planServings: number;
  onCheckOff: (slug: string) => void;
  onTapRecipe: (slug: string) => void;
  onServingsChange: (slug: string, servings: number) => void;
  onSwap: (slug: string) => void;
  onRemove: (slug: string) => void;
}

export default function MealPlanCard({ meal, recipe, planServings, onCheckOff, onTapRecipe, onServingsChange, onSwap, onRemove }: Props) {
  const currentServings = meal.servings ?? planServings;

  return (
    <div className={`${styles.card} ${meal.made ? styles.made : ""}`}>
      <button
        className={styles.checkbox}
        onClick={() => !meal.made && onCheckOff(meal.recipeSlug)}
        aria-label={meal.made ? "Made" : "Mark as made"}
      >
        {meal.made ? "✓" : ""}
      </button>

      <div className={styles.info} onClick={() => onTapRecipe(meal.recipeSlug)}>
        <div className={styles.name}>{meal.recipeName}</div>
        <div className={styles.meta}>
          {recipe?.cuisine && <span className={styles.badge}>{recipe.cuisine}</span>}
          {recipe?.totalTime && <span className={styles.time}>{recipe.totalTime}</span>}
          <span className={styles.addedBy}>{meal.addedBy}</span>
        </div>
        {meal.made && meal.notes && (
          <div className={styles.notes}>{meal.notes}</div>
        )}
      </div>

      <div className={styles.actions}>
        {!meal.made && (
          <>
            <div className={styles.servingsRow} onClick={(e) => e.stopPropagation()}>
              <button
                className={styles.stepBtn}
                onClick={() => onServingsChange(meal.recipeSlug, Math.max(1, currentServings - 1))}
                disabled={currentServings <= 1}
                aria-label="Fewer servings"
              >−</button>
              <span className={styles.servingsCount}>{currentServings}</span>
              <button
                className={styles.stepBtn}
                onClick={() => onServingsChange(meal.recipeSlug, Math.min(10, currentServings + 1))}
                disabled={currentServings >= 10}
                aria-label="More servings"
              >+</button>
            </div>
            <button
              className={styles.swapBtn}
              onClick={(e) => { e.stopPropagation(); onSwap(meal.recipeSlug); }}
              aria-label="Swap meal"
              title="Swap"
            >⇄</button>
          </>
        )}
        <button
          className={styles.removeBtn}
          onClick={(e) => { e.stopPropagation(); onRemove(meal.recipeSlug); }}
          aria-label="Remove meal"
          title="Remove"
        >×</button>
      </div>
    </div>
  );
}
