"use client";

import type { PlannedMeal } from "@/lib/mealplan/types";
import type { Recipe } from "@/lib/recipes/types";
import styles from "./MealPlanCard.module.css";

interface Props {
  meal: PlannedMeal;
  recipe?: Recipe;
  onCheckOff: (slug: string) => void;
  onTapRecipe: (slug: string) => void;
}

export default function MealPlanCard({ meal, recipe, onCheckOff, onTapRecipe }: Props) {
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
    </div>
  );
}
