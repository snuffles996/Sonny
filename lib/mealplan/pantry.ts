// Thin wrapper — all pantry state now lives in pantry:shared via lib/pantry/store.ts.
// This file preserves the existing call sites without requiring changes elsewhere.
import { getPantryStaples, addStaples, removeStaples } from "@/lib/pantry/store";

export async function getExclusions(): Promise<string[]> {
  return getPantryStaples();
}

export async function addExclusion(name: string): Promise<string[]> {
  return addStaples([name]);
}

export async function removeExclusion(name: string): Promise<string[]> {
  return removeStaples([name]);
}

export async function getCombinedExclusions(): Promise<string[]> {
  return getPantryStaples();
}
