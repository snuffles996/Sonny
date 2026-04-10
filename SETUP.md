# Sonny — Setup & Continuation Guide

## What's already done (work machine)

- [x] SSH key for personal GitHub (`snuffles996`) created and configured
- [x] Git repo initialized, pushed to `github.com:snuffles996/Sonny`
- [x] `.gitignore` and `.npmrc` (public registry override) committed
- [x] Vercel CLI installed and authenticated on work machine
- [x] Architecture design document in repo (`personal-ai-architecture.md`)

---

## Personal machine setup

### 1. SSH key for GitHub

Generate a key and add it to your GitHub account:

```bash
ssh-keygen -t ed25519 -C "kevindavid.mclaughlin@gmail.com" -f ~/.ssh/id_ed25519
ssh-add ~/.ssh/id_ed25519
```

Add the public key to GitHub:
- `cat ~/.ssh/id_ed25519.pub` → copy the output
- Go to https://github.com/settings/keys → "New SSH key" → paste

Test: `ssh -T git@github.com` → should say "Hi snuffles996!"

### 2. Clone the repo

```bash
git clone git@github.com:snuffles996/Sonny.git
cd Sonny
git config user.name "Kevin McLaughlin"
git config user.email "kevindavid.mclaughlin@gmail.com"
```

### 3. Install Vercel CLI

```bash
npm install -g vercel
vercel login  # use kevindavid.mclaughlin@gmail.com
```

### 4. Scaffold Next.js app

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --no-import-alias --turbopack --yes
```

This will create the Next.js project in the repo root. Say yes to overwrite existing files if prompted.

### 5. Create project structure

After scaffolding, create the API route structure for the backend:

```
src/
├── app/
│   ├── api/
│   │   ├── chat/
│   │   │   └── route.ts          # Main chat endpoint (intent classification + response)
│   │   ├── profile/
│   │   │   └── route.ts          # GET/PUT personal profile
│   │   ├── notes/
│   │   │   └── route.ts          # Save/query notes via Pinecone
│   │   ├── calendar/
│   │   │   └── route.ts          # CalDAV read/write
│   │   └── health/
│   │       └── route.ts          # Health check
│   ├── layout.tsx                 # Root layout
│   ├── page.tsx                   # Chat interface (main page)
│   └── globals.css                # Tailwind globals
├── lib/
│   ├── anthropic.ts               # Claude API client
│   ├── pinecone.ts                # Pinecone client + helpers
│   ├── context.ts                 # Context assembly (profile + vectors + session)
│   ├── intent.ts                  # Intent classification logic
│   ├── profile.ts                 # Profile read/write
│   └── kv.ts                      # Vercel KV for session turns
├── components/
│   ├── chat/
│   │   ├── ChatContainer.tsx      # Main chat component
│   │   ├── MessageList.tsx        # Message history display
│   │   └── MessageInput.tsx       # Text input + send
│   └── ui/                        # Shared UI components
└── types/
    └── index.ts                   # Shared TypeScript types
```

### 6. Install dependencies

After scaffolding, install the project-specific packages:

```bash
npm install @anthropic-ai/sdk @pinecone-database/pinecone @vercel/kv
```

### 7. Environment variables

Create `.env.local` (not committed):

```
ANTHROPIC_API_KEY=
PINECONE_API_KEY=
PINECONE_INDEX=sonny
KV_REST_API_URL=
KV_REST_API_TOKEN=
```

### 8. Link to Vercel

```bash
vercel link
```

### 9. PWA config (later)

For PWA support, add `next-pwa` and a `manifest.json` once the chat UI is working.

---

## Build order (from architecture doc)

1. Backend API — core endpoints, intent classification, Claude integration
2. Pinecone setup — index, namespaces, first ingestion
3. PWA frontend — chat UI, history, notifications
4. Action Button — Scriptable deep-links
5. CalDAV integration
6. Pattern detection + weekly briefing
7. Sarah's account
8. Cross-user pattern detection
9. TestFlight iOS app
