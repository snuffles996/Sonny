import { getRedisClient } from "@/lib/redis/client";

export interface ListItem {
  id: string;
  text: string;
  category?: string;
  addedAt: string;
  checked: boolean;
}

function listKey(userId: string, listName: string): string {
  return `list:${userId}:${listName}`;
}

export async function getList(
  userId: string,
  listName: string
): Promise<ListItem[]> {
  const redis = getRedisClient();
  const raw = await redis.get<ListItem[]>(listKey(userId, listName));
  return raw ?? [];
}

export async function addItems(
  userId: string,
  listName: string,
  newItems: string[],
  categorize: (items: string[]) => Promise<Map<string, string>>
): Promise<ListItem[]> {
  const existing = await getList(userId, listName);
  const existingTexts = new Set(existing.map((i) => i.text.toLowerCase()));

  const toAdd = newItems.filter((item) => !existingTexts.has(item.toLowerCase()));
  if (!toAdd.length) return existing;

  const categoryMap = await categorize(toAdd);

  const newListItems: ListItem[] = toAdd.map((text) => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    text,
    category: categoryMap.get(text.toLowerCase().trim()) ?? "Other",
    addedAt: new Date().toISOString(),
    checked: false,
  }));

  const updated = [...existing, ...newListItems];
  const redis = getRedisClient();
  await redis.set(listKey(userId, listName), updated);
  return updated;
}

export async function removeItem(
  userId: string,
  listName: string,
  itemId: string
): Promise<void> {
  const existing = await getList(userId, listName);
  const updated = existing.filter((i) => i.id !== itemId);
  const redis = getRedisClient();
  await redis.set(listKey(userId, listName), updated);
}

export async function clearList(
  userId: string,
  listName: string
): Promise<void> {
  const redis = getRedisClient();
  await redis.del(listKey(userId, listName));
}

// Returns all list names the user has created (scans list:{userId}:* keys).
export async function getAllListNames(userId: string): Promise<string[]> {
  const redis = getRedisClient();
  const prefix = `list:${userId}:`;
  const keys = await redis.keys(`${prefix}*`);
  return keys.map((k) => k.slice(prefix.length)).sort();
}
