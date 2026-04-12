import { getList, addItems } from "@/lib/lists/store";
import { categorizeItems } from "@/lib/lists/categorize";

export async function handleListWrite(
  userId: string,
  listName: string,
  items: string[]
): Promise<string> {
  if (!items.length) {
    return "I didn't catch any items to add. What would you like to put on the list?";
  }

  const updated = await addItems(userId, listName, items, categorizeItems);

  // Items that were actually new (not duplicates)
  const addedItems = updated.filter((i) =>
    items.some((orig) => orig.toLowerCase() === i.text.toLowerCase())
  );
  const skipped = items.length - addedItems.length;

  // Group the full list by category for the confirmation
  const byCategory = updated.reduce(
    (acc, item) => {
      const cat = item.category ?? "Other";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(item.text);
      return acc;
    },
    {} as Record<string, string[]>
  );

  const listLabel = listName.charAt(0).toUpperCase() + listName.slice(1);
  const addedCount = addedItems.length;

  if (!addedCount) {
    return `Everything you mentioned is already on your ${listLabel} list.`;
  }

  const summary = Object.entries(byCategory)
    .map(([cat, its]) => `${cat}: ${its.join(", ")}`)
    .join("\n");

  const skipNote = skipped > 0 ? ` (${skipped} already on the list)` : "";
  return `Added ${addedCount} item${addedCount !== 1 ? "s" : ""} to your ${listLabel} list${skipNote}:\n${summary}`;
}

export async function handleListRead(
  userId: string,
  listName: string
): Promise<string> {
  const items = await getList(userId, listName);
  const listLabel = listName.charAt(0).toUpperCase() + listName.slice(1);

  if (!items.length) {
    return `Your ${listLabel} list is empty.`;
  }

  const byCategory = items.reduce(
    (acc, item) => {
      const cat = item.category ?? "Other";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(item.text);
      return acc;
    },
    {} as Record<string, string[]>
  );

  const lines = Object.entries(byCategory)
    .map(([cat, its]) => `**${cat}**\n${its.map((i) => `  • ${i}`).join("\n")}`)
    .join("\n\n");

  return `Here's your ${listLabel} list:\n\n${lines}`;
}
