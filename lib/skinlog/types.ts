export type TimeOfDay = "morning" | "midday" | "evening" | "night";

export interface SkinProduct {
  name: string;
  amount?: string;
}

export interface SkinLogEntry {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  time: TimeOfDay;
  products: SkinProduct[];
  symptoms: string;
  rating: 1 | 2 | 3 | 4 | 5; // 1=very bad, 5=very good
  notes?: string;
  createdAt: string;
}
