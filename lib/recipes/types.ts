export type RecipeMealType = "breakfast" | "lunch" | "dinner" | "snack" | "dessert";

export interface Recipe {
  slug: string;
  name: string;
  cuisine: string;
  source: string;
  url?: string;
  photoUrl?: string;
  mealType?: RecipeMealType; // defaults to "dinner" when absent
  servings?: number;
  totalTime?: string;
  addedDate?: string;
  lastMade?: string;
  notes?: string;
  content: string; // markdown body: ## Ingredients + ## Instructions
}
