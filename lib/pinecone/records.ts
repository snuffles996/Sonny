// Upsert and search using Pinecone Inference API for embeddings + standard vector operations.
// The index (dimension 1024, cosine) stores pre-computed llama-text-embed-v2 vectors.

import { getIndex, NAMESPACES } from "./client";
import type { UserId } from "@/lib/profile/types";

const EMBED_MODEL = "llama-text-embed-v2";

async function embed(
  texts: string[],
  inputType: "passage" | "query"
): Promise<number[][]> {
  const res = await fetch("https://api.pinecone.io/embed", {
    method: "POST",
    headers: {
      "Api-Key": process.env.PINECONE_API_KEY!,
      "Content-Type": "application/json",
      "X-Pinecone-API-Version": "2025-04",
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      inputs: texts.map((text) => ({ text })),
      parameters: { input_type: inputType },
    }),
  });

  if (!res.ok) {
    throw new Error(`Pinecone embed failed: ${res.status}`);
  }

  const data = await res.json();
  return data.data.map((d: { values: number[] }) => d.values);
}

function userNamespaces(userId: UserId): string[] {
  const personal =
    userId === "kevin" ? NAMESPACES.kevinNotes : NAMESPACES.kylieNotes;
  const savedSearch = `${userId}-search`;
  return [
    personal,
    savedSearch,
    NAMESPACES.sharedRestaurants,
    NAMESPACES.sharedRecipes,
    NAMESPACES.sharedTravel,
  ];
}

// Exported single-text embed helpers for use in other modules
export async function embedPassage(text: string): Promise<number[]> {
  const [vector] = await embed([text], "passage");
  return vector;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embed([text], "query");
  return vector;
}

export async function saveNote(userId: UserId, text: string): Promise<string> {
  const index = getIndex();
  const namespace =
    userId === "kevin" ? NAMESPACES.kevinNotes : NAMESPACES.kylieNotes;
  const id = crypto.randomUUID();

  const [vector] = await embed([text], "passage");
  await index.namespace(namespace).upsert({
    records: [
      { id, values: vector, metadata: { text, userId, createdAt: Date.now() } },
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

  const [queryVector] = await embed([query], "query");

  const searches = await Promise.allSettled(
    namespaces.map((ns) =>
      index.namespace(ns).query({
        vector: queryVector,
        topK,
        includeMetadata: true,
      })
    )
  );

  return searches
    .flatMap((r) =>
      r.status === "fulfilled" ? (r.value.matches ?? []) : []
    )
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, topK)
    .map((match) => match.metadata?.text as string)
    .filter(Boolean);
}
