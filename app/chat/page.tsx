"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import BottomNav from "@/components/BottomNav";
import BookCard from "@/components/BookCard";
import MovieCard from "@/components/MovieCard";
import type { ChatCard } from "@/lib/types/cards";
import styles from "./chat.module.css";

interface Message {
  role: "user" | "assistant";
  content: string;
  cards?: ChatCard[];
}

interface PendingAction {
  type: string;
  payload: Record<string, unknown>;
  confirmationRequired: boolean;
}

const TOKEN_KEY = "sonny_token";
const VISITED_KEY = "sonny_visited";
const MESSAGES_KEY = "sonny_chat_messages";

const FIRST_VISIT_GREETING = `Hey, I'm Sonny — your personal AI.

Here's what I can do:

- **Remember things** — *"Note that I want to try Nobu in Malibu"*
- **Search your memory** — *"What restaurants have I saved?"*
- **Calendar** — *"What's on my schedule this week?"* or *"Add a dentist appointment Thursday at 2pm"*
- **Recipes** — *"What can I make with ground beef?"*
- **Update your profile** — *"I'm vegetarian"* or *"I work from home on Fridays"*

What would you like to start with?`;

const REGULAR_GREETING = `What's on your mind?`;

export default function ChatPage() {
  const [token, setToken] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenError, setTokenError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isFirstVisit, setIsFirstVisit] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) setToken(stored);
  }, []);

  useEffect(() => {
    if (!token) return;
    // Restore persisted messages
    try {
      const saved = localStorage.getItem(MESSAGES_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Message[];
        if (Array.isArray(parsed) && parsed.length > 0) setMessages(parsed);
      }
    } catch { /* ignore parse errors */ }
    if (!localStorage.getItem(VISITED_KEY)) {
      setIsFirstVisit(true);
      localStorage.setItem(VISITED_KEY, "1");
    }
  }, [token]);

  // Persist messages whenever they change
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
    }
  }, [messages]);

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

  const executeAction = useCallback(
    async (action: PendingAction) => {
      if (!token || loading) return;
      setLoading(true);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ message: "confirmed", confirmAction: action }),
        });
        if (res.status === 401) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(MESSAGES_KEY);
          setToken(null);
          setMessages([]);
          return;
        }
        const data = await res.json();
        setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      } catch {
        setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong. Please try again." }]);
      } finally {
        setLoading(false);
        inputRef.current?.focus();
      }
    },
    [token, loading]
  );

  function handleConfirm() {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);
    void executeAction(action);
  }

  const send = useCallback(
    async (message: string) => {
      if (!token || !message.trim() || loading) return;

      setPendingAction(null);
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
          localStorage.removeItem(MESSAGES_KEY);
          setToken(null);
          setMessages([]);
          return;
        }

        const data = await res.json();
        // Strip any leftover <action> block from the displayed reply
        const replyText = (data.reply as string).replace(/<action>[\s\S]*?<\/action>/, "").trim();
        setMessages((prev) => [...prev, { role: "assistant", content: replyText, cards: data.cards }]);

        if (data.pendingAction) {
          if (data.pendingAction.confirmationRequired) {
            setPendingAction(data.pendingAction);
          } else {
            void executeAction(data.pendingAction);
          }
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Something went wrong. Please try again." },
        ]);
      } finally {
        setLoading(false);
        inputRef.current?.focus();
      }
    },
    [token, loading, executeAction]
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
          <div className={`${styles.bubble} ${styles.assistantBubble}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {isFirstVisit ? FIRST_VISIT_GREETING : REGULAR_GREETING}
            </ReactMarkdown>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={styles.messageGroup}>
            <div
              className={`${styles.bubble} ${
                msg.role === "user" ? styles.userBubble : styles.assistantBubble
              }`}
            >
              {msg.role === "user" ? (
                msg.content
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {msg.content}
                </ReactMarkdown>
              )}
            </div>
            {msg.cards && msg.cards.length > 0 && (
              <div className={styles.cardList}>
                {msg.cards.map((card, ci) =>
                  card.type === "book" ? (
                    <BookCard key={ci} card={card} />
                  ) : (
                    <MovieCard key={ci} card={card} />
                  )
                )}
              </div>
            )}
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

      {pendingAction?.confirmationRequired && (
        <div className={styles.confirmBar}>
          <button onClick={handleConfirm} className={styles.confirmButton} disabled={loading}>
            Confirm
          </button>
          <button onClick={() => setPendingAction(null)} className={styles.cancelButton} disabled={loading}>
            Cancel
          </button>
        </div>
      )}

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
      <BottomNav />
    </div>
  );
}
