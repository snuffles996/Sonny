"use client";

import { useState } from "react";
import type { ChatCard } from "@/lib/types/cards";
import styles from "./MediaCard.module.css";

const TOKEN_KEY = "sonny_token";

interface MovieCardProps {
  card: ChatCard;
}

export default function MovieCard({ card }: MovieCardProps) {
  const [imgErr, setImgErr] = useState(false);
  const [added, setAdded] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleAdd() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || loading) return;
    const action = card.actions.find((a) => a.action === "add_movie");
    if (!action) return;
    setLoading(true);
    try {
      await fetch("/api/library/movies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(action.payload),
      });
      setAdded(true);
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }

  const addAction = card.actions.find((a) => a.action === "add_movie");

  return (
    <div className={styles.card}>
      <div className={styles.cover}>
        {card.coverUrl && !imgErr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.coverUrl}
            alt=""
            className={styles.coverImg}
            onError={() => setImgErr(true)}
          />
        ) : (
          <div className={styles.coverPlaceholder} />
        )}
      </div>
      <div className={styles.body}>
        <p className={styles.cardTitle}>{card.title}</p>
        <p className={styles.cardSubtitle}>{card.subtitle}</p>
        {card.status && (
          <span className={styles.cardStatus}>{card.status}</span>
        )}
        <div className={styles.actions}>
          {card.inLibrary ? (
            <span className={styles.inLibrary}>In library</span>
          ) : addAction ? (
            <button
              className={`${styles.actionBtn} ${added ? styles.actionAdded : ""}`}
              onClick={handleAdd}
              disabled={added || loading}
            >
              {added ? "Added" : loading ? "Adding…" : addAction.label}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
