export interface Recipe {
  slug: string;
  name: string;
  cuisine: string;
  source: string;
  url?: string;
  photoUrl?: string; // Vercel Blob URL for photo-imported recipes
  servings?: number;
  totalTime?: string;
  addedDate?: string;
  lastMade?: string;
  notes?: string; // user tips from the recipe list
  content: string; // markdown body: ## Ingredients + ## Instructions
}
