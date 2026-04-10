# Personal AI system — architecture design document

## Overview

A personal AI system built around a cloud backend, vector database, and PWA frontend. Fully separate from the work vault. Designed for two users (Kevin + wife) with shared namespaces for common categories.

---

## Stack

| Layer | Tool | Notes |
|---|---|---|
| Backend hosting | Vercel | Serverless functions, free tier |
| Vector database | Pinecone | Single index, multiple namespaces |
| AI model | Anthropic API | Claude for reasoning, embeddings for vectorization |
| PWA frontend | Vercel | Same account, separate deployment |
| Calendar | iCloud CalDAV | Read + write |
| Note mirror | Obsidian (iCloud) | Async write, not source of truth |
| Dev / maintenance | Claude Code (desktop) | For architecture changes and larger implementations |

---

## Data architecture

### Pinecone namespaces

| Namespace | Owner | Contents | Retention |
|---|---|---|---|
| `kevin-notes` | Kevin | Life vault notes | Indefinite |
| `kevin-conversations` | Kevin | Chat history | Indefinite (purge policy TBD) |
| `sarah-notes` | Sarah | Life vault notes | Indefinite |
| `sarah-conversations` | Sarah | Chat history | Indefinite (purge policy TBD) |
| `shared-restaurants` | Both | Restaurant notes | Indefinite |
| `shared-movies` | Both | Movies / shows / books | Indefinite |
| `shared-recipes` | Both | Recipes | Indefinite |
| `shared-travel` | Both | Travel notes | Indefinite |

### Shared namespace rules
- Either user can write to shared namespaces
- Each record tagged with `added_by` field (Kevin or Sarah)
- Default query scope: own namespace + shared (Option A)
- Future: opt-in cross-user query within shared categories (Option B)
- Periodic pattern detection job looks for content to promote to shared

### Alongside Pinecone
- Simple key-value store (Vercel KV) for raw recent conversation turns (last 3–5 exchanges, current session only — used for ordering, not semantic search)

---

## Personal profiles

Flat structured document per user, injected into every Claude call automatically. Not stored in Pinecone — always included in system prompt.

**Fields (editable by telling Claude to update):**
- Home location
- Work location
- Commute corridor
- Hobbies and interests
- Dietary preferences / restrictions
- Any other standing context

Used automatically for location-aware queries (gyms near commute, restaurants near work, etc.) without needing to state it each time.

---

## Backend API — core functions

### Intent classification
All input goes to Claude first. Claude classifies intent:
- **Save note** → embed + store in Pinecone + async write to Obsidian
- **Query** → retrieve context + respond
- **Calendar action** → read or write CalDAV (writes require confirmation)
- **Profile update** → update profile document

### Context assembly (per API call)

```
System prompt
+ Personal profile (always included)
+ Relevant past conversation snippets (semantic search: kevin-conversations)
+ Recent turns from current session (Vercel KV, last 3–5, in order)
+ Relevant vault notes (semantic search: kevin-notes + relevant shared namespaces)
+ Calendar context (if time-relevant)
+ Current message
```

### Scheduled jobs
- **Pattern detection** — scans Pinecone for emerging clusters, surfaces suggestions in chat
- **Cross-user pattern detection** — compares Kevin and Sarah's notes for shared namespace candidates
- **Weekly briefing** — summary of patterns found, structure suggestions, upcoming calendar context

---

## Input flow

```
PWA chat interface (primary)
    ↓
Action Button + Scriptable → deep-links into PWA (fast capture)
    ↓
Backend API (Vercel)
    ↓
Claude classifies intent
    ↓
Vector DB / Calendar / Profile
    ↓
Response back to PWA
```

Obsidian vault is written to asynchronously — it is a read-only browsing mirror, not the source of truth. iCloud sync lag does not affect the system.

---

## Multi-user

- Kevin and Sarah have separate Vercel deployments (or separate auth within one deployment)
- Separate profiles, separate namespaces, separate conversation histories
- Shared namespaces queryable by both
- No cross-access to personal namespaces (by default)
- Future: opt-in bridging of personal namespaces within shared categories

---

## Frontend — PWA

- Built with React / Next.js, hosted on Vercel
- Chat interface with persistent history
- Push notifications (iOS 16.4+ supported for PWAs)
- Action Button on iPhone deep-links directly into PWA

### Future: TestFlight iOS app
- PWA wrapped with Capacitor
- Same codebase, packaged as native iOS app
- Personal use only, no App Store review required
- Unlocks: true native notifications, Siri shortcuts, widgets

---

## Calendar integration

- Protocol: CalDAV (iCloud native)
- Auth: one-time setup, stored securely in Vercel environment variables
- Read: pulls events on demand or when message seems time-relevant
- Write: always requires explicit confirmation before adding/modifying events

---

## What stays separate

- Work vault (Obsidian + MCP + structured index) — completely air-gapped, no shared backend, no shared auth
- Claude Code on desktop used for engineering work on the personal system itself

---

## Build order

1. Backend API (Vercel) — core endpoints, intent classification, Claude integration
2. Pinecone setup — index, namespaces, first ingestion of existing notes
3. PWA frontend — chat UI, history, notifications
4. Action Button reconfiguration — Scriptable deep-links to PWA
5. CalDAV integration — read first, write later
6. Pattern detection + weekly briefing — after real data exists in Pinecone
7. Sarah's account — separate namespace setup, shared namespaces
8. Cross-user pattern detection — after both accounts have data
9. TestFlight iOS app — when PWA is stable

---

## Open decisions (for later)

- Purge policy for conversation history
- Exact mechanism for promoting notes to shared namespaces (manual, auto-detect, or prompted)
- Cross-user query opt-in (Option B) implementation
- `added_by` attribution in shared namespaces
- Vercel KV vs alternative for session storage
