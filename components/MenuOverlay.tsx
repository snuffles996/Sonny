"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Film,
  ChefHat,
  ChevronRight,
  User,
} from "lucide-react";
import styles from "./MenuOverlay.module.css";

const TOKEN_KEY = "sonny_token";

interface MenuOverlayProps {
  open: boolean;
  onClose: () => void;
}

export default function MenuOverlay({ open, onClose }: MenuOverlayProps) {
  const router = useRouter();
  const [userName, setUserName] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    fetch("/api/profile", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.userId) {
          const name = String(data.userId);
          setUserName(name.charAt(0).toUpperCase() + name.slice(1));
        }
      })
      .catch(() => {});
  }, [open]);

  // Lock body scroll while open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  function navigate(href: string) {
    onClose();
    router.push(href);
  }

  if (!open) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.sheet}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Settings / account row */}
        <button
          className={styles.settingsRow}
          onClick={() => navigate("/settings")}
        >
          <span className={styles.settingsAvatar}>
            <User size={20} />
          </span>
          <span className={styles.settingsText}>
            <span className={styles.settingsName}>{userName || "Account"}</span>
            <span className={styles.settingsSub}>Settings &amp; preferences</span>
          </span>
          <ChevronRight size={18} className={styles.chevron} />
        </button>

        <hr className={styles.divider} />

        <p className={styles.sectionLabel}>Library</p>

        <button className={styles.row} onClick={() => navigate("/books")}>
          <span className={styles.rowIcon}>
            <BookOpen size={20} />
          </span>
          <span className={styles.rowLabel}>Books</span>
          <ChevronRight size={18} className={styles.chevron} />
        </button>

        <button className={styles.row} onClick={() => navigate("/movies")}>
          <span className={styles.rowIcon}>
            <Film size={20} />
          </span>
          <span className={styles.rowLabel}>Movies &amp; TV</span>
          <ChevronRight size={18} className={styles.chevron} />
        </button>

        <button className={styles.row} onClick={() => navigate("/recipes")}>
          <span className={styles.rowIcon}>
            <ChefHat size={20} />
          </span>
          <span className={styles.rowLabel}>Recipes</span>
          <ChevronRight size={18} className={styles.chevron} />
        </button>
      </div>
    </div>
  );
}
