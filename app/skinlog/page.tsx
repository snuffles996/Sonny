"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import BottomNav from "@/components/BottomNav";
import LogEntryModal from "@/components/LogEntryModal";
import type { SkinLogEntry, TimeOfDay, SkinProduct } from "@/lib/skinlog/types";
import styles from "./skinlog.module.css";

const TOKEN_KEY = "sonny_token";

const RATING_COLORS: Record<number, string> = {
  1: "#ef4444",
  2: "#f97316",
  3: "#eab308",
  4: "#84cc16",
  5: "#4ade80",
};

const TIME_LABELS: Record<TimeOfDay, string> = {
  morning: "Morning",
  midday: "Midday",
  evening: "Evening",
  night: "Night",
};

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function SkinLogPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [entries, setEntries] = useState<SkinLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) { router.replace("/chat"); return; }
    setToken(t);
  }, [router]);

  useEffect(() => {
    if (!token) return;
    fetch("/api/skinlog", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => setEntries(data.entries ?? []))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSave(data: {
    date: string;
    time: TimeOfDay;
    products: SkinProduct[];
    symptoms: string;
    rating: 1 | 2 | 3 | 4 | 5;
    notes?: string;
  }) {
    if (!token) return;
    setSaving(true);
    const res = await fetch("/api/skinlog", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (result.entry) {
      setEntries((prev) => [...prev, result.entry].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }
    setSaving(false);
    setShowModal(false);
  }

  async function handleDelete(id: string) {
    if (!token) return;
    await fetch("/api/skinlog", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  // Group entries by date, sorted newest first
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const byDate = new Map<string, SkinLogEntry[]>();
  for (const e of sorted) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date)!.push(e);
  }

  // 7-day average rating
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  const recentEntries = entries.filter((e) => new Date(e.date) >= sevenDaysAgo);
  const avgRating = recentEntries.length > 0
    ? (recentEntries.reduce((sum, e) => sum + e.rating, 0) / recentEntries.length).toFixed(1)
    : null;

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>Loading…</div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerRow}>
          <h1 className={styles.title}>Skin Log</h1>
          {avgRating && (
            <div className={styles.avgBadge} style={{ color: RATING_COLORS[Math.round(Number(avgRating))] }}>
              7-day avg: {avgRating}
            </div>
          )}
        </div>
      </div>

      <div className={styles.content}>
        {byDate.size === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyText}>No entries yet.</p>
            <p className={styles.emptyHint}>Track daily products and symptoms to spot patterns.</p>
            <button className={styles.emptyBtn} onClick={() => setShowModal(true)}>Log first entry</button>
          </div>
        ) : (
          <div className={styles.list}>
            {Array.from(byDate.entries()).map(([date, dateEntries]) => (
              <div key={date} className={styles.dateGroup}>
                <div className={styles.dateLabel}>{formatDate(date)}</div>
                {dateEntries.map((entry) => (
                  <div key={entry.id} className={styles.entry}>
                    <div className={styles.entryHeader}>
                      <span className={styles.timeLabel}>{TIME_LABELS[entry.time]}</span>
                      <span
                        className={styles.ratingDot}
                        style={{ background: RATING_COLORS[entry.rating] }}
                        title={`Rating: ${entry.rating}/5`}
                      />
                      <button
                        className={styles.deleteBtn}
                        onClick={() => handleDelete(entry.id)}
                        aria-label="Delete entry"
                      >✕</button>
                    </div>
                    {entry.products.length > 0 && (
                      <div className={styles.products}>
                        {entry.products.map((p, i) => (
                          <span key={i} className={styles.productTag}>
                            {p.name}{p.amount ? ` (${p.amount})` : ""}
                          </span>
                        ))}
                      </div>
                    )}
                    {entry.symptoms && (
                      <p className={styles.symptoms}>{entry.symptoms}</p>
                    )}
                    {entry.notes && (
                      <p className={styles.notes}>{entry.notes}</p>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <button className={styles.fab} onClick={() => setShowModal(true)} aria-label="Add entry">+</button>

      <BottomNav />

      {showModal && (
        <LogEntryModal
          onSave={handleSave}
          onCancel={() => setShowModal(false)}
          saving={saving}
        />
      )}
    </div>
  );
}
