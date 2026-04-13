"use client";

import { useState, useEffect } from "react";
import BottomNav from "@/components/BottomNav";
import styles from "./settings.module.css";

const TOKEN_KEY = "sonny_token";

interface UserProfile {
  userId: string;
  homeLocation: string;
  workLocation: string;
  commuteCorridor: string;
  hobbiesAndInterests: string[];
  dietaryPreferences: string[];
  standingContext: string;
}

export default function SettingsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [homeLocation, setHomeLocation] = useState("");
  const [workLocation, setWorkLocation] = useState("");
  const [commuteCorridor, setCommuteCorridor] = useState("");
  const [dietaryPreferences, setDietaryPreferences] = useState("");
  const [hobbiesAndInterests, setHobbiesAndInterests] = useState("");
  const [standingContext, setStandingContext] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    setToken(stored);
    if (!stored) {
      setLoading(false);
      return;
    }
    fetch("/api/profile", {
      headers: { Authorization: `Bearer ${stored}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error("Unauthorized");
        return r.json();
      })
      .then((data: UserProfile) => {
        setProfile(data);
        setHomeLocation(data.homeLocation ?? "");
        setWorkLocation(data.workLocation ?? "");
        setCommuteCorridor(data.commuteCorridor ?? "");
        setDietaryPreferences((data.dietaryPreferences ?? []).join(", "));
        setHobbiesAndInterests((data.hobbiesAndInterests ?? []).join(", "));
        setStandingContext(data.standingContext ?? "");
      })
      .catch(() => setError("Failed to load profile."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    if (!token) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          homeLocation: homeLocation.trim(),
          workLocation: workLocation.trim(),
          commuteCorridor: commuteCorridor.trim(),
          dietaryPreferences: dietaryPreferences
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          hobbiesAndInterests: hobbiesAndInterests
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          standingContext: standingContext.trim(),
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Failed to save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const displayName = profile?.userId
    ? profile.userId.charAt(0).toUpperCase() + profile.userId.slice(1)
    : "";

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Settings</h1>

        {loading && <p className={styles.muted}>Loading…</p>}

        {!loading && !token && (
          <p className={styles.muted}>Not signed in.</p>
        )}

        {!loading && token && profile && (
          <>
            <div className={styles.accountRow}>
              <span className={styles.accountName}>{displayName}</span>
              <span className={styles.accountSub}>Personal account</span>
            </div>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Locations</h2>

              <label className={styles.label}>
                Home
                <input
                  className={styles.input}
                  value={homeLocation}
                  onChange={(e) => setHomeLocation(e.target.value)}
                  placeholder="e.g. Santa Monica, CA"
                />
              </label>

              <label className={styles.label}>
                Work
                <input
                  className={styles.input}
                  value={workLocation}
                  onChange={(e) => setWorkLocation(e.target.value)}
                  placeholder="e.g. Century City, CA"
                />
              </label>

              <label className={styles.label}>
                Commute corridor
                <input
                  className={styles.input}
                  value={commuteCorridor}
                  onChange={(e) => setCommuteCorridor(e.target.value)}
                  placeholder="e.g. I-10 West to 405 North"
                />
              </label>
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Preferences</h2>

              <label className={styles.label}>
                Dietary preferences
                <input
                  className={styles.input}
                  value={dietaryPreferences}
                  onChange={(e) => setDietaryPreferences(e.target.value)}
                  placeholder="e.g. vegetarian, gluten-free (comma-separated)"
                />
              </label>

              <label className={styles.label}>
                Hobbies &amp; interests
                <input
                  className={styles.input}
                  value={hobbiesAndInterests}
                  onChange={(e) => setHobbiesAndInterests(e.target.value)}
                  placeholder="e.g. hiking, photography (comma-separated)"
                />
              </label>
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Standing context</h2>
              <label className={styles.label}>
                Anything Sonny should always know
                <textarea
                  className={`${styles.input} ${styles.textarea}`}
                  value={standingContext}
                  onChange={(e) => setStandingContext(e.target.value)}
                  placeholder="e.g. I work from home on Fridays. My partner's name is Kylie."
                  rows={4}
                />
              </label>
            </section>

            {error && <p className={styles.error}>{error}</p>}

            <button
              className={styles.saveButton}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
            </button>
          </>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
