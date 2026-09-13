import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { Profile } from "../types/database";

export function useHouseholdMembers(householdId: string | undefined) {
  const [members, setMembers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!householdId) {
      setMembers([]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    supabase
      .from("household_members")
      .select("profiles(*)")
      .eq("household_id", householdId)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error("Failed to load household members", error);
          setLoading(false);
          return;
        }
        const loaded = ((data ?? []) as unknown as { profiles: Profile | null }[])
          .map((row) => row.profiles)
          .filter((p): p is Profile => p !== null);
        setMembers(loaded);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [householdId]);

  return { members, loading };
}
