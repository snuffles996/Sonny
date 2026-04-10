// User profile — injected into every Claude call, not stored in Pinecone

export type UserId = "kevin" | "sarah";

export interface UserProfile {
  userId: UserId;
  homeLocation: string;
  workLocation: string;
  commuteCorridor: string;
  hobbiesAndInterests: string[];
  dietaryPreferences: string[];
  standingContext: string; // free-form notes
  updatedAt: string; // ISO timestamp
}
