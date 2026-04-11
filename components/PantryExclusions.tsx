"use client";

import { useState } from "react";
import styles from "./PantryExclusions.module.css";

interface Props {
  exclusions: string[];
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
}

export default function PantryExclusions({ exclusions, onAdd, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");

  function handleAdd() {
    const name = inputValue.trim().toLowerCase();
    if (!name) return;
    onAdd(name);
    setInputValue("");
  }

  return (
    <div className={styles.section}>
      <button className={styles.toggle} onClick={() => setOpen((o) => !o)}>
        <span>Pantry items excluded ({exclusions.length})</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <>
          <div className={styles.chips}>
            {exclusions.map((e) => (
              <span key={e} className={styles.chip}>
                {e}
                <button className={styles.chipRemove} onClick={() => onRemove(e)} aria-label={`Remove ${e}`}>
                  ×
                </button>
              </span>
            ))}
          </div>

          <div className={styles.addRow}>
            <input
              className={styles.addInput}
              placeholder="Add item to exclude…"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            />
            <button className={styles.addBtn} onClick={handleAdd} disabled={!inputValue.trim()}>
              Add
            </button>
          </div>
        </>
      )}
    </div>
  );
}
