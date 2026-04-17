export type ActionType =
  | "save_note"
  | "list_write"
  | "list_add_item"
  | "calendar_write"
  | "movie_update"
  | "movie_add"
  | "book_update"
  | "book_add"
  | "recipe_add";

export interface PendingAction {
  type: ActionType;
  payload: Record<string, unknown>;
  confirmationRequired: boolean;
}

export function parsePendingAction(reply: string): PendingAction | null {
  const match = reply.match(/<action>([\s\S]*?)<\/action>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim()) as PendingAction;
  } catch {
    return null;
  }
}

export function stripActionBlock(reply: string): string {
  return reply.replace(/<action>[\s\S]*?<\/action>/, "").trim();
}
