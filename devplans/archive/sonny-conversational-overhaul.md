# Sonny — Conversational Overhaul Spec

*Goal: Transform the request/response loop from rigid intent → handler execution into a fluid,
assistant-first conversation where Claude reasons about context, searches proactively, surfaces
options naturally, and only executes actions when confident or confirmed.*

---

## What Changes (and What Doesn't)

**Stays the same:**
- All data stores (Redis, Pinecone) — untouched
- All handler logic (calendar, recipes, meal plan, lists, sports, etc.)
- Auth, session, profile loading
- The dual-model pattern (Sonnet for conversation, Haiku for extraction)

**Changes:**
- `app/api/chat/route.ts` — the main orchestration loop
- `lib/anthropic/classify.ts` — demoted from gatekeeper to lightweight signal
- `lib/anthropic/respond.ts` — expanded into the new conversational core
- New: `lib/anthropic/context.ts` — broad context loader
- New: `lib/anthropic/actions.ts` — action parser + confirmation state

---

## New Request Flow

```
OLD:
  classify intent → switch(intent) → execute handler → return reply

NEW:
  load context (parallel) →
    Claude reasons + responds naturally →
      parse pending actions from response →
        if confirmed action → execute handler →
  return { reply, pendingAction? }
```

### Pseudocode

```ts
// app/api/chat/route.ts

export async function POST(req) {
  const userId = authenticateUser(req)           // unchanged
  const { message, confirmAction } = await req.json()

  // --- 1. Load context in parallel ---
  const [profile, recentTurns, broadContext] = await Promise.all([
    getProfile(userId),
    getRecentTurns(userId),
    loadBroadContext(userId, message),           // NEW — see below
  ])

  // --- 2. Check for confirmed action from previous turn ---
  if (confirmAction) {
    const result = await executeConfirmedAction(confirmAction, userId)
    await appendTurns(userId, message, result.reply)
    return { reply: result.reply, intent: confirmAction.type }
  }

  // --- 3. High-confidence structural pre-classification (Haiku, lightweight) ---
  // Only used to short-circuit unambiguous structural commands.
  // If confidence < HIGH or intent is conversational → skip, let Claude handle it.
  const signal = await getIntentSignal(message)   // returns null if ambiguous

  if (signal?.highConfidence && STRUCTURAL_INTENTS.includes(signal.intent)) {
    // e.g. "add Warriors schedule to calendar", "clear meal plan"
    const result = await executeStructuralIntent(signal, userId, profile)
    await appendTurns(userId, message, result.reply)
    return { reply: result.reply, intent: signal.intent }
  }

  // --- 4. Claude-first conversational response ---
  const { reply, pendingAction } = await generateConversationalResponse({
    userId,
    message,
    profile,
    recentTurns,
    broadContext,
  })

  await appendTurns(userId, message, reply)
  return { reply, pendingAction }   // pendingAction flows back to client for confirmation UI
}
```

---

## New: `lib/anthropic/context.ts` — Broad Context Loader

Instead of searching only one Pinecone namespace per intent, search all relevant namespaces
simultaneously and return a unified context blob.

```ts
// lib/anthropic/context.ts

export async function loadBroadContext(userId: string, message: string): Promise<BroadContext> {

  // Search all namespaces the user might be referencing.
  // Use the raw message as the query — don't pre-filter by intent.
  const [notes, movies, books, restaurants] = await Promise.all([
    searchPinecone(`${userId}-notes`, message, topK: 4),
    searchPinecone('shared-movies', message, topK: 4),
    searchPinecone('shared-books', message, topK: 3),
    searchPinecone('shared-restaurants', message, topK: 3),
  ])

  // Also pull structured data that's cheap and always relevant
  const activeMealPlan = await getActiveMealPlan()   // Redis, already cached

  return { notes, movies, books, restaurants, activeMealPlan }
}

// Shape:
type BroadContext = {
  notes: PineconeMatch[]
  movies: PineconeMatch[]
  books: PineconeMatch[]
  restaurants: PineconeMatch[]
  activeMealPlan: MealPlan | null
}
```

---

## New: `lib/anthropic/respond.ts` — Conversational Response Generator

This replaces the old `generateResponse()`. Claude now receives rich context and reasons openly.

```ts
// lib/anthropic/respond.ts

export async function generateConversationalResponse({
  userId, message, profile, recentTurns, broadContext
}): Promise<{ reply: string; pendingAction: PendingAction | null }> {

  const systemPrompt = buildSystemPrompt(userId, profile, broadContext)

  const response = await anthropic.messages.create({
    model: MODEL,   // Sonnet 4.6
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      ...formatRecentTurns(recentTurns),
      { role: 'user', content: message }
    ]
  })

  const reply = response.content[0].text

  // Parse reply for any action Claude is proposing
  const pendingAction = parsePendingAction(reply)

  return { reply, pendingAction }
}
```

---

## System Prompt Design

This is the most important change. The system prompt shifts Claude's orientation from
task-executor to thoughtful personal assistant.

```ts
function buildSystemPrompt(userId: string, profile: UserProfile, ctx: BroadContext): string {
  return `
You are Sonny, a personal AI assistant for ${userId === 'kevin' ? 'Kevin' : 'Kylie'}.
You are warm, direct, and thoughtful. You do not sound like a chatbot. You sound like a
trusted assistant who knows them well.

## Your personality
- Respond naturally, like a person would. Not bullet points unless it genuinely helps.
- If something is unclear, ask one focused question — don't list five options.
- Be proactive: if you can see what they probably want, say so and offer to do it.
- Surface relevant context they didn't ask for if it's clearly useful.
- When you're going to take an action, say so clearly: "I'll mark that as watched" or
  "Want me to add that to your list?" — not vague acknowledgment.

## What you know right now

### Their profile
Name: ${profile.userId}
Dietary preferences: ${profile.dietaryPreferences?.join(', ') || 'none on file'}
Interests: ${profile.hobbiesAndInterests?.join(', ') || 'none on file'}
Standing context: ${profile.standingContext || 'none'}

### Relevant context from their library (search results for this message)

**Notes:**
${formatMatches(ctx.notes) || 'Nothing closely relevant.'}

**Movies & TV:**
${formatMatches(ctx.movies) || 'Nothing closely relevant.'}

**Books:**
${formatMatches(ctx.books) || 'Nothing closely relevant.'}

**Restaurants:**
${formatMatches(ctx.restaurants) || 'Nothing closely relevant.'}

**Active meal plan:**
${ctx.activeMealPlan ? formatMealPlan(ctx.activeMealPlan) : 'No active plan.'}

## How to handle actions
When you believe the user wants to take an action (save something, mark something, add to a list,
create a calendar event, etc.) — don't just do it silently. Acknowledge what you found, confirm
what you're about to do, and if there's any ambiguity, ask first.

When you are ready to execute an action, include this JSON block at the very end of your
response, after your natural reply — the system will parse it and handle execution:

<action>
{
  "type": "mark_watched" | "save_note" | "list_write" | "calendar_write" | "recipe_add" | ...,
  "payload": { ...relevant fields... },
  "confirmationRequired": true | false
}
</action>

Only include an <action> block when you are confident about what to do. If you're not sure,
just ask — don't guess.
`.trim()
}
```

---

## Action Parsing — `lib/anthropic/actions.ts`

```ts
// lib/anthropic/actions.ts

export type PendingAction = {
  type: ActionType
  payload: Record<string, unknown>
  confirmationRequired: boolean
}

// Strip the <action> block from Claude's reply and parse it
export function parsePendingAction(reply: string): PendingAction | null {
  const match = reply.match(/<action>([\s\S]*?)<\/action>/)
  if (!match) return null

  try {
    return JSON.parse(match[1].trim()) as PendingAction
  } catch {
    return null
  }
}

// Strip <action> block from the reply text before sending to client
export function stripActionBlock(reply: string): string {
  return reply.replace(/<action>[\s\S]*?<\/action>/, '').trim()
}
```

---

## Action Execution — `executeConfirmedAction()`

```ts
// Still lives in route.ts or a new lib/anthropic/execute.ts

async function executeConfirmedAction(action: PendingAction, userId: string) {
  switch (action.type) {

    case 'mark_watched':
      // update movie record in Pinecone with watched=true metadata
      await markMovieWatched(action.payload.movieId)
      return { reply: `Marked "${action.payload.title}" as watched. ✓` }

    case 'save_note':
      await upsertNote(userId, action.payload)
      return { reply: `Saved.` }

    case 'list_write':
      await handleListWrite(userId, action.payload)
      return { reply: `Added to your ${action.payload.listName} list.` }

    case 'calendar_write':
      const eventDetails = action.payload   // already extracted by Claude in the action block
      await createEvent(eventDetails)
      return { reply: `Done — added to your calendar.` }

    // ... other action types map to existing handlers ...

    default:
      return { reply: `I wasn't sure how to do that. Can you say a bit more?` }
  }
}
```

---

## Client-Side Changes

The client needs to handle the `pendingAction` in the response and render a confirmation UI
when `confirmationRequired: true`.

```ts
// Pseudocode — in your chat component

const response = await sendMessage(message)

if (response.pendingAction?.confirmationRequired) {
  // Show confirm button in UI
  setPendingAction(response.pendingAction)
} else if (response.pendingAction) {
  // Auto-execute low-confidence actions (e.g. saving a note)
  await sendConfirmation(response.pendingAction)
}

// On confirm button tap:
async function handleConfirm() {
  const result = await fetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      message: 'confirmed',
      confirmAction: pendingAction
    })
  })
  setPendingAction(null)
}
```

---

## Structural Intents — Keep Bypassing Claude

Some intents are so unambiguous that running them through Claude first adds latency with no
benefit. Keep these on the fast path (Haiku classify → execute directly):

```ts
const STRUCTURAL_INTENTS = [
  'sports_calendar_bulk',   // "add all Warriors games to calendar"
  'meal_plan_create',       // "make me a meal plan"
  'meal_plan_clear',        // "clear the meal plan"
  'meal_plan_grocery',      // "show me the grocery list"
  'staples_read',           // "what are my staples"
  'staples_update',         // "add olive oil to staples"
  'profile_update',         // "my dietary prefs are now..."
  'calendar_read',          // "what's on my calendar this week"
  'sports_standings',       // "Warriors standings"
]

// Everything else — movie queries, book searches, notes, list reads/writes,
// anything involving fuzzy matching or ambiguity — goes through Claude-first.
```

---

## Haiku Classifier — Demoted Role

`classifyIntent()` in `lib/anthropic/classify.ts` still runs, but now its job is smaller:
return a signal with a confidence score, not a definitive action gate.

```ts
// Updated ClassificationResult shape
type ClassificationResult = {
  intent: IntentType | 'conversational'   // 'conversational' = let Claude handle it
  confidence: 'high' | 'low'
  listName?: string
  items?: string[]
  // ... other extraction fields unchanged
}

// In the prompt, tell Haiku:
// "If the message is clearly a structured command (add to calendar, update staples, etc.)
//  return the intent with confidence: high.
//  If it's conversational, a question, a fuzzy reference to a movie/book/show, or anything
//  involving searching or deciding — return intent: 'conversational', confidence: 'low'."
```

---

## What Claude Code Should Do

Paste this into Claude Code with the following instruction:

> Implement the conversational overhaul described in this spec. Work file by file in this order:
>
> 1. **`lib/anthropic/context.ts`** — Create new file. Implement `loadBroadContext()` searching
>    all four Pinecone namespaces in parallel using the existing `searchNotes()` pattern.
>    Add `getActiveMealPlan()` pull from Redis. Return typed `BroadContext` object.
>
> 2. **`lib/anthropic/actions.ts`** — Create new file. Implement `PendingAction` type,
>    `parsePendingAction()`, and `stripActionBlock()` exactly as specced above.
>
> 3. **`lib/anthropic/classify.ts`** — Update `ClassificationResult` to add `confidence` field.
>    Update Haiku prompt to return `intent: 'conversational'` with `confidence: 'low'` for
>    anything fuzzy, a question, or involving library search. Keep all existing intent values.
>
> 4. **`lib/anthropic/respond.ts`** — Replace `generateResponse()` with
>    `generateConversationalResponse()`. Implement `buildSystemPrompt()` with the full
>    context-injected prompt from this spec. Call `parsePendingAction()` and
>    `stripActionBlock()` on the response. Return `{ reply, pendingAction }`.
>
> 5. **`app/api/chat/route.ts`** — Restructure the main handler:
>    - Add `confirmAction` to request body parsing
>    - Add `executeConfirmedAction()` early-return branch
>    - Add `STRUCTURAL_INTENTS` constant
>    - Replace the full `switch(intent)` block with: structural fast-path + Claude-first fallback
>    - Structural intents keep their existing handlers unchanged
>    - Pass `pendingAction` through to response
>
> 6. **Client chat component** — Add `pendingAction` state. Render a confirm button when
>    `confirmationRequired: true`. On confirm, POST back with `confirmAction` in the body.
>    Strip the `<action>` block from displayed reply text.
>
> **Do not modify any of the following:** data stores, Pinecone search functions, CalDAV client,
> sports handlers, meal plan logic, list categorization, recipe extraction.
> All existing handler functions stay intact — only their invocation path changes.

---

## Expected Behavior After This Change

**Before:**
> You: "I finished watching Severance last night"
> Sonny: "I didn't find Severance on your list."

**After:**
> You: "I finished watching Severance last night"
> Sonny: "Nice — I've got Severance in your list. Want me to mark it as watched?"
> [Confirm button]
> You: *taps confirm*
> Sonny: "Marked. Good show."

---

**Before:**
> You: "I need something to watch tonight, something kind of dark"
> Sonny: "Here are some dark shows: ..."  *(generic, ignores your actual list)*

**After:**
> You: "I need something to watch tonight, something kind of dark"
> Sonny: "From your list, you've got Succession and True Detective unwatched — both pretty dark.
>         Succession's more slow-burn, True Detective is bleaker. Any preference, or want me to
>         look up what else is out right now?"
