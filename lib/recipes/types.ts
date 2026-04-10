export interface Recipe {
  slug: string;
  name: string;
  cuisine: string;
  source: string;
  url?: string;
  servings?: number;
  totalTime?: string;
  addedDate?: string;
  lastMade?: string;
  notes?: string; // user tips from the recipe list
  content: string; // markdown body: ## Ingredients + ## Instructions
}
