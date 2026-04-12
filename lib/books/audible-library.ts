// Searches Kevin's Audible library via Pinecone semantic search.
// Requires the kevin-audible namespace to be seeded first — run scripts/sync-audible.mjs.

import { getIndex } from "@/lib/pinecone/client";

const NAMESPACE = "kevin-audible";
const EMBED_MODEL = "llama-text-embed-v2";

async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch("https://api.pinecone.io/embed", {
    method: "POST",
    headers: {
      "Api-Key": process.env.PINECONE_API_KEY!,
      "Content-Type": "application/json",
      "X-Pinecone-API-Version": "2025-04",
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      inputs: [{ text }],
      parameters: { input_type: "query" },
    }),
  });
  if (!res.ok) throw new Error(`Pinecone embed failed: ${res.status}`);
  const data = await res.json();
  return data.data[0].values;
}

export interface AudibleBook {
  asin: string;
  title: string;
  authors: string;
  narrator: string;
  runtimeMinutes: number;
  series: string;
  summary: string;
  purchaseDate: string;
  audibleUrl: string;
  score: number;
}

export async function searchAudibleLibrary(query: string, topK = 5): Promise<AudibleBook[]> {
  const index = getIndex();
  const vector = await embedQuery(query);

  const results = await index.namespace(NAMESPACE).query({
    vector,
    topK,
    includeMetadata: true,
  });

  return (results.matches ?? []).map((match) => ({
    asin: (match.metadata?.asin as string) ?? "",
    title: (match.metadata?.title as string) ?? "",
    authors: (match.metadata?.authors as string) ?? "",
    narrator: (match.metadata?.narrator as string) ?? "",
    runtimeMinutes: (match.metadata?.runtime_minutes as number) ?? 0,
    series: (match.metadata?.series as string) ?? "",
    summary: (match.metadata?.summary as string) ?? "",
    purchaseDate: (match.metadata?.purchase_date as string) ?? "",
    audibleUrl: (match.metadata?.audible_url as string) ?? "",
    score: match.score ?? 0,
  }));
}
