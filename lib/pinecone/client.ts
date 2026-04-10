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
  sarahNotes: "sarah-notes",
  sarahConversations: "sarah-conversations",
  sharedRestaurants: "shared-restaurants",
  sharedMovies: "shared-movies",
  sharedRecipes: "shared-recipes",
  sharedTravel: "shared-travel",
} as const;
