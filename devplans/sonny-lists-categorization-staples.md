# Sonny — Lists, Categorization & Pantry Staples Implementation

**Features:**
1. First-class `list_write` / `list_read` intents with Redis storage
2. Grocery item categorization fix (potato buns → Bakery, not Produce)
3. Pantry staples as a user-managed Redis document
4. User correction loop for categorization overrides

**Touches:** `lib/anthropic/classify.ts`, `lib/lists/` (new), `lib/pantry/` (new), `app/api/chat/route.ts`

---

## Part 1 — Lists

### 1a. Update Haiku classifier — `lib/anthropic/classify.ts`

Add `list_write` and `list_read` to the intent enum. Extend the forced tool_use schema to return `listName` and `items` fields when these intents are detected. Do this in one classification call — no second Haiku call needed.

**Add to intent enum:**
```typescript
"list_write" | "list_read"
```

**Add to classification system prompt:**
```
- list_write: User wants to add one or more discrete items to a named list.
  Triggered by: "add X to my Y list", "put X on the Costco list", "I need to
  grab X", "pick up X", store names (Costco, Target, Trader Joe's, etc.) combined
  with item nouns. NOT a note. NOT a recipe. Individual buyable or doable items.

- list_read: User wants to hear back the contents of a named list.
  Triggered by: "what's on my X list", "read me my Costco list", "show me my
  grocery list".

  IMPORTANT: Do NOT classify as save_note or query if the user mentions a list
  name or store name alongside item-like nouns. List intents take priority.
```

**Extend the tool schema response shape** to include these fields when intent is `list_write` or `list_read`:

```typescript
// Add to your classification tool's output schema:
listName: {
  type: "string",
  description: "Normalized lowercase list name. Map store names to their canonical form: 'costco run' → 'costco', 'grocery list' → 'grocery', 'trader joes' → 'traderjoes'. Always lowercase, no spaces."
},
items: {
  type: "array",
  items: { type: "string" },
  description: "Individual items to add. Each item should be a clean noun phrase: 'paper towels', 'olive oil'. Only populated for list_write."
},
category: {
  type: "string",
  description: "Optional. If the user specifies a category or store section, include it. Otherwise omit."
}
```

---

### 1b. New file: `lib/lists/store.ts`

Redis key pattern: `list:{userId}:{listName}` → JSON array of item objects.

```typescript
import { redis } from "@/lib/redis/client";

export interface ListItem {
  id: string;           // nanoid or timestamp-based
  text: string;         // "potato buns"
  category?: string;    // "Bakery" — set at write time or categorized later
  addedAt: string;      // ISO timestamp
  checked: boolean;     // for future UI checkbox support
}

function listKey(userId: string, listName: string): string {
  return `list:${userId}:${listName}`;
}

export async function getList(
  userId: string,
  listName: string
): Promise<ListItem[]> {
  const raw = await redis.get(listKey(userId, listName));
  if (!raw) return [];
  return typeof raw === "string" ? JSON.parse(raw) : (raw as ListItem[]);
}

export async function addItems(
  userId: string,
  listName: string,
  newItems: string[],
  categorize: (items: string[], userId: string) => Promise<Map<string, string>>
): Promise<ListItem[]> {
  const existing = await getList(userId, listName);
  const existingTexts = new Set(existing.map((i) => i.text.toLowerCase()));

  // Deduplicate — don't add if already on list
  const toAdd = newItems.filter((item) => !existingTexts.has(item.toLowerCase()));

  // Categorize new items
  const categoryMap = await categorize(toAdd, userId);

  const newListItems: ListItem[] = toAdd.map((text) => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    text,
    category: categoryMap.get(text.toLowerCase()) ?? "Uncategorized",
    addedAt: new Date().toISOString(),
    checked: false,
  }));

  const updated = [...existing, ...newListItems];
  await redis.set(listKey(userId, listName), JSON.stringify(updated));
  return updated;
}

export async function clearList(
  userId: string,
  listName: string
): Promise<void> {
  await redis.del(listKey(userId, listName));
}

export async function removeItem(
  userId: string,
  listName: string,
  itemId: string
): Promise<void> {
  const existing = await getList(userId, listName);
  const updated = existing.filter((i) => i.id !== itemId);
  await redis.set(listKey(userId, listName), JSON.stringify(updated));
}
```

---

### 1c. New file: `lib/lists/handler.ts`

Handles `list_write` and `list_read` intents in the chat router.

```typescript
import { getList, addItems } from "@/lib/lists/store";
import { categorizeItems } from "@/lib/lists/categorize"; // see Part 2

export async function handleListWrite(
  userId: string,
  listName: string,
  items: string[]
): Promise<string> {
  if (!items.length) {
    return "I didn't catch any items to add. What would you like to put on the list?";
  }

  const updated = await addItems(userId, listName, items, categorizeItems);

  // Group by category for confirmation message
  const byCategory = updated.reduce((acc, item) => {
    const cat = item.category ?? "Other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item.text);
    return acc;
  }, {} as Record<string, string[]>);

  const addedCount = items.length;
  const listLabel = listName.charAt(0).toUpperCase() + listName.slice(1);
  const summary = Object.entries(byCategory)
    .map(([cat, its]) => `${cat}: ${its.join(", ")}`)
    .join("\n");

  return `Added ${addedCount} item${addedCount > 1 ? "s" : ""} to your ${listLabel} list:\n${summary}`;
}

export async function handleListRead(
  userId: string,
  listName: string
): Promise<string> {
  const items = await getList(userId, listName);
  if (!items.length) {
    const listLabel = listName.charAt(0).toUpperCase() + listName.slice(1);
    return `Your ${listLabel} list is empty.`;
  }

  // Group by category
  const byCategory = items.reduce((acc, item) => {
    const cat = item.category ?? "Other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item.text);
    return acc;
  }, {} as Record<string, string[]>);

  const listLabel = listName.charAt(0).toUpperCase() + listName.slice(1);
  const lines = Object.entries(byCategory)
    .map(([cat, its]) => `**${cat}**\n${its.map((i) => `  • ${i}`).join("\n")}`)
    .join("\n\n");

  return `Here's your ${listLabel} list:\n\n${lines}`;
}
```

---

## Part 2 — Categorization

### 2a. New file: `lib/lists/categorize.ts`

Haiku-based categorization with user override injection and pantry staples awareness.
This is the fix for potato buns → Produce. The explicit category map grounds Haiku correctly.

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { HAIKU_MODEL } from "@/lib/anthropic/client";
import { getOverrides } from "@/lib/lists/overrides";
import { getPantryStaples } from "@/lib/pantry/store";

const anthropic = new Anthropic();

const CATEGORY_MAP = `
Grocery store categories and what belongs in each. Use ONLY these category names:

- Produce: Fresh fruits, fresh vegetables, fresh herbs, mushrooms, bagged salad
- Bakery: Bread, buns, rolls, bagels, tortillas, pita, muffins, croissants — ANY baked good
- Meat & Seafood: Raw meat, poultry, fish, seafood, deli meat, bacon, sausage
- Dairy & Eggs: Milk, cheese, butter, yogurt, cream, eggs, non-dairy milk alternatives
- Frozen: Anything frozen — vegetables, meals, ice cream, frozen fruit
- Pantry: Canned goods, pasta, rice, grains, oils, vinegar, sauces, condiments, spices, baking ingredients, nuts, dried beans
- Beverages: Water, juice, soda, coffee, tea, alcohol, sports drinks
- Snacks: Chips, crackers, cookies, candy, granola bars, popcorn
- Personal Care: Soap, shampoo, toothpaste, deodorant, razors, vitamins
- Household: Paper towels, toilet paper, cleaning supplies, trash bags, laundry detergent, batteries
- Baby & Pet: Pet food, pet supplies, baby food, diapers

Key rules:
- "Potato buns" → Bakery (not Produce — potato is the flavor, not the form)
- "Sweet potato" → Produce (it IS a vegetable)
- "Almond milk" → Dairy & Eggs
- "Frozen vegetables" → Frozen (not Produce)
- "Canned tomatoes" → Pantry (not Produce)
- "Turkey" (raw) → Meat & Seafood; "Turkey" (deli) → Meat & Seafood
- When in doubt between Pantry and another category, prefer the more specific category
`;

export async function categorizeItems(
  items: string[],
  userId: string
): Promise<Map<string, string>> {
  if (!items.length) return new Map();

  // Load user-specific overrides and pantry staples for context
  const [overrides, staples] = await Promise.all([
    getOverrides(userId),
    getPantryStaples(userId),
  ]);

  // Apply known overrides immediately — no Haiku call needed for these
  const result = new Map<string, string>();
  const needsCategorization: string[] = [];

  for (const item of items) {
    const override = overrides.get(item.toLowerCase());
    if (override) {
      result.set(item.toLowerCase(), override);
    } else {
      needsCategorization.push(item);
    }
  }

  if (!needsCategorization.length) return result;

  const staplesContext = staples.length
    ? `\nNote: The user considers these pantry staples (already stocked): ${staples.join(", ")}. You may still categorize them if asked, but flag them as staples in your reasoning.`
    : "";

  const prompt = `${CATEGORY_MAP}${staplesContext}

Categorize each of these grocery items. Respond ONLY with valid JSON, no markdown:
{
  "categories": {
    "item name": "Category Name",
    ...
  }
}

Items to categorize:
${needsCategorization.map((i) => `- ${i}`).join("\n")}`;

  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    const categories = parsed.categories as Record<string, string>;
    for (const [item, category] of Object.entries(categories)) {
      result.set(item.toLowerCase(), category);
    }
  } catch {
    // Fallback: mark all uncategorized as Other
    for (const item of needsCategorization) {
      result.set(item.toLowerCase(), "Other");
    }
  }

  return result;
}
```

---

### 2b. New file: `lib/lists/overrides.ts`

User-specific categorization corrections, stored in Redis. Updated when the user says
"potato buns should be in Bakery, not Produce."

```typescript
import { redis } from "@/lib/redis/client";

function overrideKey(userId: string): string {
  return `category-overrides:${userId}`;
}

export async function getOverrides(userId: string): Promise<Map<string, string>> {
  const raw = await redis.get(overrideKey(userId));
  if (!raw) return new Map();
  const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
  return new Map(Object.entries(obj as Record<string, string>));
}

export async function addOverride(
  userId: string,
  item: string,
  category: string
): Promise<void> {
  const existing = await getOverrides(userId);
  existing.set(item.toLowerCase(), category);
  await redis.set(overrideKey(userId), JSON.stringify(Object.fromEntries(existing)));
}
```

**Add a `categorization_correction` intent to the Haiku classifier:**

```
- categorization_correction: User is correcting where an item was categorized.
  Triggered by: "X should be in Y", "X doesn't belong in Y", "move X to Y",
  "X goes in Y not Z". Extract the item name and the correct category.
```

**Extend classifier schema** to return `correctionItem` and `correctionCategory` for this intent.

**Add to `chat/route.ts`:**
```typescript
if (intent === "categorization_correction") {
  await addOverride(userId, correctionItem, correctionCategory);
  return `Got it — I'll put ${correctionItem} in ${correctionCategory} from now on.`;
}
```

---

## Part 3 — Pantry Staples

### 3a. New file: `lib/pantry/store.ts`

Pantry staples stored in Redis. Editable by telling Sonny. Injected into
categorization prompts and (later) meal planning / recipe shopping list generation.

```typescript
import { redis } from "@/lib/redis/client";

function pantryKey(userId: string): string {
  return `pantry:${userId}`;
}

export async function getPantryStaples(userId: string): Promise<string[]> {
  const raw = await redis.get(pantryKey(userId));
  if (!raw) return DEFAULT_STAPLES;
  return typeof raw === "string" ? JSON.parse(raw) : (raw as string[]);
}

export async function addStaples(
  userId: string,
  items: string[]
): Promise<string[]> {
  const existing = await getPantryStaples(userId);
  const updated = Array.from(new Set([...existing, ...items.map((i) => i.toLowerCase())]));
  await redis.set(pantryKey(userId), JSON.stringify(updated));
  return updated;
}

export async function removeStaples(
  userId: string,
  items: string[]
): Promise<string[]> {
  const existing = await getPantryStaples(userId);
  const toRemove = new Set(items.map((i) => i.toLowerCase()));
  const updated = existing.filter((s) => !toRemove.has(s));
  await redis.set(pantryKey(userId), JSON.stringify(updated));
  return updated;
}

// Reasonable starting defaults — Kevin can edit these via Sonny
const DEFAULT_STAPLES: string[] = [
  "olive oil",
  "vegetable oil",
  "salt",
  "black pepper",
  "garlic",
  "onions",
  "butter",
  "flour",
  "sugar",
  "baking soda",
  "baking powder",
  "soy sauce",
  "chicken broth",
  "canned tomatoes",
  "pasta",
  "rice",
  "eggs",
  "milk",
  "parmesan",
  "red pepper flakes",
  "cumin",
  "paprika",
  "oregano",
];
```

---

### 3b. Add `staples_update` to Haiku classifier

```
- staples_update: User wants to add or remove items from their pantry staples list.
  Triggered by: "add X to my staples", "I always have X", "X is always in my pantry",
  "remove X from staples", "I'm out of X" (when X is a pantry item).
  Extract: action ("add" | "remove") and items array.
```

**Extend classifier schema:**
```typescript
staplesAction: "add" | "remove",
staplesItems: string[]
```

**Add to `chat/route.ts`:**
```typescript
if (intent === "staples_update") {
  if (staplesAction === "add") {
    const updated = await addStaples(userId, staplesItems);
    return `Added to your pantry staples: ${staplesItems.join(", ")}. You now have ${updated.length} staples on record.`;
  } else {
    const updated = await removeStaples(userId, staplesItems);
    return `Removed from staples: ${staplesItems.join(", ")}.`;
  }
}
```

---

### 3c. Add a `staples_read` intent

```
- staples_read: User wants to see their pantry staples list.
  Triggered by: "what are my staples", "show me my pantry staples",
  "what do I always have".
```

```typescript
if (intent === "staples_read") {
  const staples = await getPantryStaples(userId);
  return `Your pantry staples (${staples.length} items):\n${staples.join(", ")}`;
}
```

---

## Part 4 — Wire everything into `app/api/chat/route.ts`

```typescript
import { handleListWrite, handleListRead } from "@/lib/lists/handler";
import { addOverride } from "@/lib/lists/overrides";
import { addStaples, removeStaples, getPantryStaples } from "@/lib/pantry/store";

// In your intent router:

switch (intent) {

  case "list_write":
    return respond(await handleListWrite(userId, classification.listName, classification.items));

  case "list_read":
    return respond(await handleListRead(userId, classification.listName));

  case "categorization_correction":
    await addOverride(userId, classification.correctionItem, classification.correctionCategory);
    return respond(`Got it — I'll put ${classification.correctionItem} in ${classification.correctionCategory} from now on.`);

  case "staples_update":
    if (classification.staplesAction === "add") {
      await addStaples(userId, classification.staplesItems);
      return respond(`Added to your pantry staples: ${classification.staplesItems.join(", ")}.`);
    } else {
      await removeStaples(userId, classification.staplesItems);
      return respond(`Removed from staples: ${classification.staplesItems.join(", ")}.`);
    }

  case "staples_read":
    const staples = await getPantryStaples(userId);
    return respond(`Your pantry staples:\n${staples.join(", ")}`);

  // ... existing cases unchanged
}
```

---

## File summary — what to create / edit

| File | Action | Notes |
|---|---|---|
| `lib/anthropic/classify.ts` | Edit | Add 5 new intents + extend schema with listName, items, staplesAction, staplesItems, correctionItem, correctionCategory |
| `lib/lists/store.ts` | Create | Redis list storage with addItems, getList, removeItem, clearList |
| `lib/lists/handler.ts` | Create | list_write and list_read response formatting |
| `lib/lists/categorize.ts` | Create | Haiku categorization with explicit category map + override injection |
| `lib/lists/overrides.ts` | Create | User-specific categorization corrections in Redis |
| `lib/pantry/store.ts` | Create | Pantry staples in Redis with defaults, add/remove helpers |
| `app/api/chat/route.ts` | Edit | Add 5 new intent branches |

---

## How these connect to the meal planning roadmap

Once this is in place, the meal planning feature (on your existing roadmap) has clean building blocks available:

- **Pantry staples** → already in Redis, injectable into any prompt
- **Recipe ingredients** → already stored in Redis per recipe
- **Shopping list generation** = recipe ingredients minus pantry staples → `addItems()` to a `grocery` list

That flow becomes roughly 20 lines of code once this foundation exists. Flag this for Claude Code so it structures `lib/pantry/store.ts` with that future use in mind — specifically, `getPantryStaples()` should be easily importable from a future `lib/recipes/shoppingList.ts`.

---

## Verification checklist

- [ ] "Add potato buns to my Costco list" → `list_write`, listName: `costco`, item in Bakery
- [ ] "What's on my Costco list" → `list_read`, returns grouped by category
- [ ] "Potato buns should be in Bakery not Produce" → `categorization_correction`, persists override, correct on next add
- [ ] "Add olive oil to my staples" → `staples_update` add
- [ ] "Remove eggs from my staples" → `staples_update` remove
- [ ] "What are my pantry staples" → `staples_read`
- [ ] "Add milk to my grocery list" → `list_write` (not `save_note`, not `query`)
- [ ] "What did I save about my Costco membership" → `query` (not `list_read`)
- [ ] Duplicate item not added twice to same list
- [ ] DEFAULT_STAPLES pre-populated on first `staples_read` before user has customized
