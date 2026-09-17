import { supabase } from "./supabase";
import { useHouseholdResource } from "./useHouseholdResource";
import type { HouseholdPlaceholder } from "../types/database";

const NO_PLACEHOLDERS: HouseholdPlaceholder[] = [];

async function fetchPlaceholders(householdId: string): Promise<HouseholdPlaceholder[] | null> {
  const { data, error } = await supabase
    .from("household_placeholders")
    .select("*")
    .eq("household_id", householdId)
    .is("claimed_by", null)
    .order("created_at");

  if (error) {
    console.error("Failed to load placeholders", error);
    return null;
  }
  return (data as HouseholdPlaceholder[]) ?? [];
}

/** Noch nicht übernommene Platzhalter einer WG. */
export function usePlaceholders(householdId: string | undefined) {
  const { data, loading, refresh } = useHouseholdResource(
    householdId,
    "placeholders",
    fetchPlaceholders,
    NO_PLACEHOLDERS
  );
  return { placeholders: data, loading, refresh };
}
