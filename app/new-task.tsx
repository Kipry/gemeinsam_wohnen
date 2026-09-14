import { useState } from "react";
import { router } from "expo-router";
import { supabase } from "../src/lib/supabase";
import { useAuth } from "../src/lib/AuthProvider";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { useHouseholdMembers } from "../src/lib/useHouseholdMembers";
import { useTeams } from "../src/lib/useTeams";
import { TaskForm, type TaskFormValues } from "../src/components/TaskForm";
import { ErrorText, Loading } from "../src/components/ui";

export default function NewTask() {
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { members, loading } = useHouseholdMembers(activeHousehold?.id);
  const { teams } = useTeams(activeHousehold?.id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading || !session || !activeHousehold) return <Loading />;

  const save = async (values: TaskFormValues) => {
    setSaving(true);
    const { error: rpcError } = await supabase.rpc("create_task", {
      p_household_id: activeHousehold.id,
      p_title: values.title,
      p_points: values.points,
      p_interval_days: values.interval_days,
      p_assignment_mode: values.assignment_mode,
      p_rotation: values.rotation,
      p_fixed_assignee: values.fixed_assignee,
      p_skip_absent: values.skip_absent,
      p_weekday: values.weekday,
    });
    setSaving(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/tasks");
  };

  return (
    <>
      {error && <ErrorText>{error}</ErrorText>}
      <TaskForm
        members={members}
        teams={teams}
        currentUserId={session.user.id}
        submitLabel="Aufgabe anlegen"
        saving={saving}
        onSubmit={save}
      />
    </>
  );
}
