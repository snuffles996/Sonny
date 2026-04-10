// Upsert and search using Pinecone integrated inference (llama-text-embed-v2).
// The index handles embedding automatically — we just pass raw text.
// Note: TEXT_FIELD must match the source field configured when creating the index.

import { getIndex, NAMESPACES } from "./client";
import type { UserId } from "@/lib/profile/types";

const TEXT_FIELD = "text"; // must match the field name set in Pinecone index config

function userNamespaces(userId: UserId): string[] {
  const personal =
    userId === "kevin" ? NAMESPACES.kevinNotes : NAMESPACES.sarahNotes;
  return [
    personal,
    NAMESPACES.sharedRestaurants,
    NAMESPACES.sharedMovies,
    NAMESPACES.sharedRecipes,
    NAMESPACES.sharedTravel,
  ];
}

export async function saveNote(userId: UserId, text: string): Promise<string> {
  const index = getIndex();
  const namespace =
    userId === "kevin" ? NAMESPACES.kevinNotes : NAMESPACES.sarahNotes;
  const id = crypto.randomUUID();

  await index.namespace(namespace).upsertRecords({
    records: [
      {
        id,
        [TEXT_FIELD]: text,
        userId,
        createdAt: Date.now(),
      },
    ],
  });

  return id;
}

export async function searchNotes(
  userId: UserId,
  query: string,
  topK = 5
): Promise<string[]> {
  const index = getIndex();
  const namespaces = userNamespaces(userId);

  const searches = await Promise.allSettled(
    namespaces.map((ns) =>
      index.namespace(ns).searchRecords({
        query: { topK, inputs: { text: query } },
        fields: [TEXT_FIELD],
      })
    )
  );

  return searches
    .flatMap((r) =>
      r.status === "fulfilled" ? (r.value.result?.hits ?? []) : []
    )
    .sort((a, b) => (b._score ?? 0) - (a._score ?? 0))
    .slice(0, topK)
    .map((hit) => (hit.fields as Record<string, string>)[TEXT_FIELD])
    .filter(Boolean);
}
