import { supabase } from "./supabase";
import { useHouseholdResource } from "./useHouseholdResource";
import type { Team } from "../types/database";

export type TeamWithMembers = Team & {
  member_ids: string[];
  /** Vorgemerkte Mitbewohner, die noch nicht beigetreten sind */
  placeholder_ids: string[];
};

type Row = Team & { team_members: { user_id: string | null; placeholder_id: string | null }[] };

const NO_TEAMS: TeamWithMembers[] = [];

async function fetchTeams(householdId: string): Promise<TeamWithMembers[] | null> {
  const { data, error } = await supabase
    .from("teams")
    .select("*, team_members(user_id, placeholder_id)")
    .eq("household_id", householdId)
    .order("created_at");

  if (error) {
    console.error("Failed to load teams", error);
    return null;
  }

  return ((data ?? []) as unknown as Row[]).map(({ team_members, ...team }) => ({
    ...team,
    member_ids: (team_members ?? []).map((m) => m.user_id).filter((id): id is string => id !== null),
    placeholder_ids: (team_members ?? [])
      .map((m) => m.placeholder_id)
      .filter((id): id is string => id !== null),
  }));
}

export function useTeams(householdId: string | undefined) {
  const { data, loading, refresh } = useHouseholdResource(householdId, "teams", fetchTeams, NO_TEAMS);
  return { teams: data, loading, refresh };
}
