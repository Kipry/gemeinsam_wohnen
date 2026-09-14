import { useCallback, useState } from "react";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Alert, View } from "react-native";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/lib/AuthProvider";
import { useHousehold } from "../../src/lib/HouseholdProvider";
import { useHouseholdMembers } from "../../src/lib/useHouseholdMembers";
import { useTeams } from "../../src/lib/useTeams";
import { usePlaceholders } from "../../src/lib/usePlaceholders";
import { TaskForm, type TaskFormInitial, type TaskFormValues } from "../../src/components/TaskForm";
import { Button, ErrorText, Loading, Muted } from "../../src/components/ui";
import type { Task, TaskRotationEntry } from "../../src/types/database";

type LoadedTask = Task & { task_rotation: TaskRotationEntry[] };

export default function TaskDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);
  const { teams } = useTeams(activeHousehold?.id);
  const { placeholders } = usePlaceholders(activeHousehold?.id);
  const [task, setTask] = useState<LoadedTask | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const { data, error: loadError } = await supabase
      .from("tasks")
      .select("*, task_rotation(*)")
      .eq("id", id)
      .single();

    if (loadError) {
      setError(loadError.message);
      return;
    }
    setTask(data as LoadedTask);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!task || !session) return <Loading />;

  const persist = async (values: TaskFormValues, active: boolean) => {
    setSaving(true);
    const { error: rpcError } = await supabase.rpc("update_task", {
      p_task_id: task.id,
      p_title: values.title,
      p_points: values.points,
      p_interval_days: values.interval_days,
      p_assignment_mode: values.assignment_mode,
      p_rotation: values.rotation,
      p_fixed_assignee: values.fixed_assignee,
      p_skip_absent: values.skip_absent,
      p_weekday: values.weekday,
      p_active: active,
    });
    setSaving(false);

    if (rpcError) {
      setError(rpcError.message);
      return false;
    }
    return true;
  };

  const save = async (values: TaskFormValues) => {
    if (await persist(values, task.active)) {
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)/tasks");
    }
  };

  const togglePause = async () => {
    const { error: rpcError } = await supabase.rpc("set_task_active", {
      p_task_id: task.id,
      p_active: !task.active,
    });

    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    load();
  };

  const remove = () => {
    Alert.alert(
      "Aufgabe löschen",
      `„${task.title}" wirklich löschen? Erledigte Termine dieser Aufgabe verschwinden damit auch aus der Statistik. Zum reinen Aussetzen lieber „Pausieren" nutzen.`,
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Löschen",
          style: "destructive",
          onPress: async () => {
            const { error: deleteError } = await supabase.from("tasks").delete().eq("id", task.id);
            if (deleteError) {
              setError(deleteError.message);
              return;
            }
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)/tasks");
          },
        },
      ]
    );
  };

  const initial: TaskFormInitial = {
    title: task.title,
    points: String(task.points),
    interval_days: String(task.interval_days),
    assignment_mode: task.assignment_mode,
    rotation: [...task.task_rotation]
      .sort((a, b) => a.position - b.position)
      .map((entry) => entry.user_id ?? entry.team_id ?? entry.placeholder_id ?? "")
      .filter(Boolean),
    fixed_assignee: task.fixed_assignee,
    skip_absent: task.skip_absent,
    weekday: task.weekday,
  };

  return (
    <>
      {error && <ErrorText>{error}</ErrorText>}
      <TaskForm
        members={members}
        teams={teams}
        placeholders={placeholders}
        currentUserId={session.user.id}
        initial={initial}
        submitLabel="Änderungen speichern"
        saving={saving}
        onSubmit={save}
        footer={
          <View style={{ gap: 10, marginTop: 8 }}>
            {!task.active && <Muted>Diese Aufgabe ist pausiert — es entstehen keine neuen Termine.</Muted>}
            <Button
              title={task.active ? "Pausieren" : "Fortsetzen"}
              variant="secondary"
              onPress={togglePause}
            />
            <Button title="Löschen" variant="danger" onPress={remove} />
          </View>
        }
      />
    </>
  );
}
