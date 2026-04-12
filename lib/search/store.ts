// Saves a web search result to the user's personal Pinecone search namespace.

import { getIndex } from "@/lib/pinecone/client";
import { embedPassage } from "@/lib/pinecone/records";

export async function saveSearchResult({
  userId,
  query,
  summary,
  tags,
  sourceUrls,
}: {
  userId: string;
  query: string;
  summary: string;
  tags: string[];
  sourceUrls: string[];
}): Promise<void> {
  const namespace = `${userId}-search`;
  const index = getIndex();

  const text = `${query}\n\n${summary}`;
  const vector = await embedPassage(text);
  const id = `search-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  await index.namespace(namespace).upsert({
    records: [
      {
        id,
        values: vector,
        metadata: {
          text,
          type: "web_search",
          query,
          summary,
          tags,
          sourceUrls,
          userId,
          createdAt: Date.now(),
        },
      },
    ],
  });
}
