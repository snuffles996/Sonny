"use client";

import { useState } from "react";
import type { GroceryItem, FoodCategory } from "@/lib/mealplan/grocery";
import styles from "./GroceryList.module.css";

const CATEGORY_ORDER: FoodCategory[] = [
  "Produce", "Proteins", "Dairy & Eggs",
  "Pantry & Dry Goods", "Canned & Jarred", "Frozen", "Beverages", "Other",
];

interface Props {
  items: GroceryItem[];
  onSendToReminders: () => void;
  sending?: boolean;
}

export default function GroceryList({ items, onSendToReminders, sending = false }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const byCategory = new Map<FoodCategory, GroceryItem[]>();
  for (const item of items) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category)!.push(item);
  }

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className={styles.container}>
      <div className={styles.list}>
        {CATEGORY_ORDER.filter((cat) => byCategory.has(cat)).map((category) => (
          <div key={category} className={styles.section}>
            <div className={styles.categoryHeader}>{category}</div>
            {byCategory.get(category)!.map((item) => {
              const key = item.name;
              const isExpanded = expanded.has(key);
              return (
                <div key={key} className={styles.item}>
                  <div className={styles.itemRow}>
                    <span className={styles.itemName}>{item.name}</span>
                    <span className={styles.itemQty}>{item.displayQty}</span>
                  </div>
                  <div className={styles.itemSource}>
                    {item.hasMultipleSources ? (
                      <button
                        className={styles.sourceTag}
                        onClick={() => toggleExpand(key)}
                      >
                        {item.sourceRecipes.length} recipes {isExpanded ? "▲" : "▼"}
                      </button>
                    ) : (
                      <span className={styles.sourceName}>{item.sourceRecipes[0]}</span>
                    )}
                    {isExpanded && (
                      <div className={styles.sourceList}>
                        {item.sourceRecipes.map((r) => (
                          <span key={r} className={styles.sourceListItem}>{r}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className={styles.footer}>
        <button
          className={styles.sendButton}
          onClick={onSendToReminders}
          disabled={sending}
        >
          {sending ? "Sending…" : "Send to Reminders"}
        </button>
      </div>
    </div>
  );
}
