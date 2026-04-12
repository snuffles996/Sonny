"use client";

import type { GroceryItem, FoodCategory } from "@/lib/mealplan/grocery";
import styles from "./GroceryList.module.css";

const CATEGORY_ORDER: FoodCategory[] = [
  "Produce", "Proteins", "Dairy & Eggs",
  "Pantry & Dry Goods", "Canned & Jarred", "Frozen", "Beverages", "Other",
  "Pantry Staples",
];

interface Props {
  items: GroceryItem[];
  checkedItems: string[];
  onToggleItem: (name: string) => void;
  onRebuild: () => void;
  rebuilding?: boolean;
}

export default function GroceryList({ items, checkedItems, onToggleItem, onRebuild, rebuilding = false }: Props) {
  const checkedSet = new Set(checkedItems);

  const byCategory = new Map<FoodCategory, GroceryItem[]>();
  for (const item of items) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category)!.push(item);
  }

  return (
    <div className={styles.container}>
      <div className={styles.listHeader}>
        <span className={styles.itemCount}>{items.length} items</span>
        <button className={styles.rebuildBtn} onClick={onRebuild} disabled={rebuilding}>
          {rebuilding ? "Rebuilding…" : "Rebuild"}
        </button>
      </div>

      <div className={styles.list}>
        {CATEGORY_ORDER.filter((cat) => byCategory.has(cat)).map((category) => (
          <div
            key={category}
            className={`${styles.section} ${category === "Pantry Staples" ? styles.pantrySection : ""}`}
          >
            <div className={styles.categoryHeader}>{category}</div>
            {byCategory.get(category)!.map((item) => {
              const checked = checkedSet.has(item.name);
              return (
                <div
                  key={item.name}
                  className={`${styles.item} ${checked ? styles.itemChecked : ""}`}
                  onClick={() => onToggleItem(item.name)}
                >
                  <div className={styles.itemRow}>
                    <div className={styles.itemLeft}>
                      <span className={`${styles.checkbox} ${checked ? styles.checkboxChecked : ""}`}>
                        {checked && "✓"}
                      </span>
                      <span className={styles.itemName}>{item.name}</span>
                    </div>
                    <span className={styles.itemQty}>{item.displayQty}</span>
                  </div>
                  {!checked && (
                    <div className={styles.itemSource}>
                      <span className={styles.sourceName}>
                        {item.hasMultipleSources
                          ? `${item.sourceRecipes.length} recipes`
                          : item.sourceRecipes[0]}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
