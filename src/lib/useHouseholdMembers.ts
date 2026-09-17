import { supabase } from "./supabase";
import { useHouseholdResource } from "./useHouseholdResource";
import type { Profile } from "../types/database";

/** Anzeigename für Personen, die ausgezogen sind oder ihr Konto gelöscht haben */
export const FORMER_MEMBER = "Ehemaliges Mitglied";

const NO_MEMBERS: Profile[] = [];

async function fetchMembers(householdId: string): Promise<Profile[] | null> {
  const { data, error } = await supabase
    .from("household_members")
    .select("profiles(*)")
    .eq("household_id", householdId);

  if (error) {
    console.error("Failed to load household members", error);
    return null;
  }

  return ((data ?? []) as unknown as { profiles: Profile | null }[])
    .map((row) => row.profiles)
    .filter((profile): profile is Profile => profile !== null);
}

export function useHouseholdMembers(householdId: string | undefined) {
  const { data, loading, refresh } = useHouseholdResource(householdId, "members", fetchMembers, NO_MEMBERS);
  return { members: data, loading, refresh };
}
