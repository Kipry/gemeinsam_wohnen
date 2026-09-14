import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { supabase } from "../src/lib/supabase";
import { useAuth } from "../src/lib/AuthProvider";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { useHouseholdMembers } from "../src/lib/useHouseholdMembers";
import { useTeams } from "../src/lib/useTeams";
import { usePlaceholders } from "../src/lib/usePlaceholders";
import { TaskForm, type TaskFormInitial, type TaskFormValues } from "../src/components/TaskForm";
import { ErrorText, Loading } from "../src/components/ui";

export default function NewTask() {
  // Vorbelegung, z.B. „Mülltonnen rausstellen" aus der Müllabfuhr
  const params = useLocalSearchParams<{ title?: string; weekday?: string; interval?: string }>();
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { members, loading } = useHouseholdMembers(activeHousehold?.id);
  const { teams } = useTeams(activeHousehold?.id);
  const { placeholders } = usePlaceholders(activeHousehold?.id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading || !session || !activeHousehold) return <Loading />;

  const preset: Partial<TaskFormInitial> | undefined = params.title
    ? {
        title: params.title,
        weekday: params.weekday !== undefined ? Number(params.weekday) : null,
        interval_days: params.interval ?? "7",
      }
    : undefined;

  const save = async (values: TaskFormValues) => {
    setSaving(true);
    const { data: created, error: rpcError } = await supabase.rpc("create_task", {
      p_household_id: activeHousehold.id,
      p_title: values.title,
      p_points: values.points,
      p_interval_days: values.interval_days,
      p_assignment_mode: values.assignment_mode,
      p_rotation: values.rotation,
      p_fixed_assignee: values.fixed_assignee,
      p_skip_absent: values.skip_absent,
      p_weekday: values.weekday,
      p_description: values.description,
    });

    if (rpcError || !created) {
      setSaving(false);
      setError(rpcError?.message ?? "Aufgabe konnte nicht angelegt werden");
      return;
    }

    if (values.checklist.length > 0) {
      const { error: checklistError } = await supabase.rpc("save_task_checklist", {
        p_task_id: (created as { id: string }).id,
        p_items: values.checklist,
      });
      if (checklistError) {
        // Die Aufgabe steht — die Liste lässt sich beim Bearbeiten nachtragen
        setSaving(false);
        router.replace(`/task/${(created as { id: string }).id}`);
        return;
      }
    }
    setSaving(false);
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/tasks");
  };

  return (
    <>
      {error && <ErrorText>{error}</ErrorText>}
      <TaskForm
        members={members}
        teams={teams}
        placeholders={placeholders}
        currentUserId={session.user.id}
        preset={preset}
        submitLabel="Aufgabe anlegen"
        saving={saving}
        onSubmit={save}
      />
    </>
  );
}
