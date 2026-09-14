import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { HouseholdPlaceholder } from "../types/database";

/** Noch nicht übernommene Platzhalter einer WG. */
export function usePlaceholders(householdId: string | undefined) {
  const [placeholders, setPlaceholders] = useState<HouseholdPlaceholder[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!householdId) {
      setPlaceholders([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("household_placeholders")
      .select("*")
      .eq("household_id", householdId)
      .is("claimed_by", null)
      .order("created_at");

    if (error) console.error("Failed to load placeholders", error);
    setPlaceholders((data as HouseholdPlaceholder[]) ?? []);
    setLoading(false);
  }, [householdId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { placeholders, loading, refresh };
}
