"use client";

import { useState } from "react";
import type { TimeOfDay, SkinProduct } from "@/lib/skinlog/types";
import styles from "./LogEntryModal.module.css";

const TIME_OPTIONS: { value: TimeOfDay; label: string }[] = [
  { value: "morning", label: "Morning" },
  { value: "midday", label: "Midday" },
  { value: "evening", label: "Evening" },
  { value: "night", label: "Night" },
];

interface Props {
  onSave: (data: {
    date: string;
    time: TimeOfDay;
    products: SkinProduct[];
    symptoms: string;
    rating: 1 | 2 | 3 | 4 | 5;
    notes?: string;
  }) => void;
  onCancel: () => void;
  saving?: boolean;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function LogEntryModal({ onSave, onCancel, saving = false }: Props) {
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState<TimeOfDay>("morning");
  const [products, setProducts] = useState<SkinProduct[]>([{ name: "", amount: "" }]);
  const [symptoms, setSymptoms] = useState("");
  const [rating, setRating] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [notes, setNotes] = useState("");

  function addProduct() {
    setProducts((prev) => [...prev, { name: "", amount: "" }]);
  }

  function updateProduct(idx: number, field: keyof SkinProduct, value: string) {
    setProducts((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
  }

  function removeProduct(idx: number) {
    setProducts((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSave() {
    const cleanProducts = products.filter((p) => p.name.trim());
    onSave({
      date,
      time,
      products: cleanProducts.map((p) => ({ name: p.name.trim(), amount: p.amount?.trim() || undefined })),
      symptoms,
      rating,
      notes: notes.trim() || undefined,
    });
  }

  const RATINGS: { value: 1 | 2 | 3 | 4 | 5; label: string; color: string }[] = [
    { value: 1, label: "Bad", color: "#ef4444" },
    { value: 2, label: "Poor", color: "#f97316" },
    { value: 3, label: "OK", color: "#eab308" },
    { value: 4, label: "Good", color: "#84cc16" },
    { value: 5, label: "Great", color: "#4ade80" },
  ];

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.sheetHeader}>
          <span className={styles.title}>Log Entry</span>
          <button className={styles.closeBtn} onClick={onCancel}>✕</button>
        </div>

        <div className={styles.body}>
          {/* Date */}
          <div className={styles.field}>
            <label className={styles.label}>Date</label>
            <input
              type="date"
              className={styles.dateInput}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          {/* Time of day */}
          <div className={styles.field}>
            <label className={styles.label}>Time of day</label>
            <div className={styles.chips}>
              {TIME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`${styles.chip} ${time === opt.value ? styles.chipActive : ""}`}
                  onClick={() => setTime(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Rating */}
          <div className={styles.field}>
            <label className={styles.label}>Skin condition</label>
            <div className={styles.ratingRow}>
              {RATINGS.map((r) => (
                <button
                  key={r.value}
                  className={`${styles.ratingBtn} ${rating === r.value ? styles.ratingActive : ""}`}
                  style={rating === r.value ? { borderColor: r.color, color: r.color } : {}}
                  onClick={() => setRating(r.value)}
                >
                  {r.value}
                  <span className={styles.ratingLabel}>{r.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Products */}
          <div className={styles.field}>
            <label className={styles.label}>Products applied</label>
            {products.map((p, idx) => (
              <div key={idx} className={styles.productRow}>
                <input
                  className={styles.productName}
                  placeholder="Product name"
                  value={p.name}
                  onChange={(e) => updateProduct(idx, "name", e.target.value)}
                />
                <input
                  className={styles.productAmount}
                  placeholder="Amount"
                  value={p.amount ?? ""}
                  onChange={(e) => updateProduct(idx, "amount", e.target.value)}
                />
                {products.length > 1 && (
                  <button className={styles.removeBtn} onClick={() => removeProduct(idx)}>✕</button>
                )}
              </div>
            ))}
            <button className={styles.addProductBtn} onClick={addProduct}>+ Add product</button>
          </div>

          {/* Symptoms */}
          <div className={styles.field}>
            <label className={styles.label}>Symptoms / observations</label>
            <textarea
              className={styles.textarea}
              placeholder="e.g. redness on cheeks, mild itching…"
              value={symptoms}
              onChange={(e) => setSymptoms(e.target.value)}
              rows={2}
            />
          </div>

          {/* Notes */}
          <div className={styles.field}>
            <label className={styles.label}>Notes (optional)</label>
            <textarea
              className={styles.textarea}
              placeholder="Anything else…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.cancel} onClick={onCancel}>Cancel</button>
          <button className={styles.save} onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
