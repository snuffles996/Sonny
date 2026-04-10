export interface Recipe {
  slug: string;
  name: string;
  cuisine: string;
  source: string;
  url?: string;
  servings?: number;
  totalTime?: string;
  content: string; // markdown body: ## Ingredients + ## Instructions
}
