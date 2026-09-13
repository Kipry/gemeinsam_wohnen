import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { Team } from "../types/database";

export type TeamWithMembers = Team & { member_ids: string[] };

export function useTeams(householdId: string | undefined) {
  const [teams, setTeams] = useState<TeamWithMembers[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!householdId) {
      setTeams([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .from("teams")
      .select("*, team_members(user_id)")
      .eq("household_id", householdId)
      .order("created_at");

    if (error) {
      console.error("Failed to load teams", error);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as unknown as (Team & { team_members: { user_id: string }[] })[];
    setTeams(rows.map(({ team_members, ...team }) => ({
      ...team,
      member_ids: (team_members ?? []).map((m) => m.user_id),
    })));
    setLoading(false);
  }, [householdId]);

  useEffect(() => {
    load();
  }, [load]);

  return { teams, loading, refresh: load };
}
