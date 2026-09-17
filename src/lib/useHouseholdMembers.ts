import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useOfflineSnapshot } from "./offlineCache";
import type { Profile } from "../types/database";

/** Anzeigename für Personen, die ausgezogen sind oder ihr Konto gelöscht haben */
export const FORMER_MEMBER = "Ehemaliges Mitglied";

export function useHouseholdMembers(householdId: string | undefined) {
  const [members, setMembers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  // Ohne Netz stünde sonst überall „Ehemaliges Mitglied" statt der Namen
  const saveSnapshot = useOfflineSnapshot<Profile[]>(householdId ? `members:${householdId}` : null, (cached) => {
    setMembers(cached);
    setLoading(false);
  });

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
        saveSnapshot(loaded);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [householdId, saveSnapshot]);

  return { members, loading };
}
