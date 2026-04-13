export type BookStatus = "shelf" | "want_to_read" | "reading" | "finished";

export interface Book {
  id: string;
  title: string;
  author: string;
  series?: string;
  seriesPosition?: number;
  audibleAsin?: string;
  status: BookStatus;
  source?: "audible" | "physical" | "kindle" | "other";
  recommendedBy?: string;
  rating?: number; // 1–5
  notes?: string;
  tags?: string[];
  coverUrl?: string; // Open Library: covers.openlibrary.org/b/isbn/{isbn}-M.jpg
  isbn?: string; // stored from Google Books for cover URL construction
  dateAdded?: string;
  dateStarted?: string;
  dateFinished?: string;
  lastSyncedAt?: string;
}
