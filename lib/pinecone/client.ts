// Singleton Pinecone client
import { Pinecone } from "@pinecone-database/pinecone";

let client: Pinecone | null = null;

export function getPineconeClient(): Pinecone {
  if (!client) {
    client = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  }
  return client;
}

export function getIndex() {
  return getPineconeClient().index(process.env.PINECONE_INDEX_NAME ?? "sonny");
}

// Namespace helpers
export const NAMESPACES = {
  kevinNotes: "kevin-notes",
  kevinConversations: "kevin-conversations",
  kylieNotes: "kylie-notes",
  kylieConversations: "kylie-conversations",
  sharedRestaurants: "shared-restaurants",
  sharedRecipes: "shared-recipes",
  sharedTravel: "shared-travel",
} as const;
