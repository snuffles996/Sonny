"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Grid2x2, MessageCircle, UtensilsCrossed } from "lucide-react";
import MenuOverlay from "./MenuOverlay";
import styles from "./BottomNav.module.css";

export default function BottomNav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <nav className={styles.nav}>
        <button
          className={`${styles.tab} ${menuOpen ? styles.active : ""}`}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className={styles.icon}>
            <Grid2x2 size={22} />
          </span>
          <span className={styles.label}>Menu</span>
        </button>

        <Link
          href="/chat"
          className={`${styles.tab} ${pathname.startsWith("/chat") ? styles.active : ""}`}
        >
          <span className={styles.icon}>
            <MessageCircle size={22} />
          </span>
          <span className={styles.label}>Chat</span>
        </Link>

        <Link
          href="/mealplan"
          className={`${styles.tab} ${pathname.startsWith("/mealplan") ? styles.active : ""}`}
        >
          <span className={styles.icon}>
            <UtensilsCrossed size={22} />
          </span>
          <span className={styles.label}>Meals</span>
        </Link>
      </nav>

      <MenuOverlay open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}
