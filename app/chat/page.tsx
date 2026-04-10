"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import styles from "./chat.module.css";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const TOKEN_KEY = "sonny_token";

export default function ChatPage() {
  const [token, setToken] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenError, setTokenError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) setToken(stored);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function handleTokenSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = tokenInput.trim();
    if (!t) return;
    setTokenError("");
    setUnlocking(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hi" }),
      });
      if (res.status === 401) {
        setTokenError("Wrong access code.");
        return;
      }
      localStorage.setItem(TOKEN_KEY, t);
      setToken(t);
      setTokenInput("");
    } catch {
      setTokenError("Connection error. Try again.");
    } finally {
      setUnlocking(false);
    }
  }

  const send = useCallback(
    async (message: string) => {
      if (!token || !message.trim() || loading) return;

      setMessages((prev) => [...prev, { role: "user", content: message }]);
      setLoading(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message }),
        });

        if (res.status === 401) {
          localStorage.removeItem(TOKEN_KEY);
          setToken(null);
          setMessages([]);
          return;
        }

        const data = await res.json();
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.reply },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Something went wrong. Please try again.",
          },
        ]);
      } finally {
        setLoading(false);
        inputRef.current?.focus();
      }
    },
    [token, loading]
  );

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Send on Enter (not Shift+Enter)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!loading && input.trim()) {
        const msg = input.trim();
        setInput("");
        send(msg);
      }
    }
  }

  function handleSendClick() {
    if (!loading && input.trim()) {
      const msg = input.trim();
      setInput("");
      send(msg);
    }
  }

  // Auto-resize textarea
  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${e.target.scrollHeight}px`;
  }

  if (!token) {
    return (
      <div className={styles.lockScreen}>
        <h1 className={styles.lockTitle}>Sonny</h1>
        <form onSubmit={handleTokenSubmit} className={styles.lockForm}>
          <input
            type="text"
            placeholder="Access code"
            value={tokenInput}
            onChange={(e) => { setTokenInput(e.target.value); setTokenError(""); }}
            className={styles.lockInput}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          {tokenError && (
            <p style={{ color: "#ff6b6b", fontSize: "0.85rem", textAlign: "center", margin: 0 }}>
              {tokenError}
            </p>
          )}
          <button type="submit" className={styles.lockButton} disabled={unlocking}>
            {unlocking ? "Checking…" : "Unlock"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.messages}>
        {messages.length === 0 && (
          <p className={styles.emptyState}>What&apos;s on your mind?</p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`${styles.bubble} ${
              msg.role === "user" ? styles.userBubble : styles.assistantBubble
            }`}
          >
            {msg.content}
          </div>
        ))}
        {loading && (
          <div
            className={`${styles.bubble} ${styles.assistantBubble} ${styles.thinking}`}
          >
            •••
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className={styles.inputBar}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          placeholder="Message"
          className={styles.input}
          disabled={loading}
          rows={1}
          autoComplete="off"
        />
        <button
          onClick={handleSendClick}
          disabled={loading || !input.trim()}
          className={styles.sendButton}
          aria-label="Send"
        >
          ↑
        </button>
      </div>
    </div>
  );
}
