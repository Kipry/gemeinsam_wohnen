import { useCallback, useMemo, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/lib/AuthProvider";
import { useHousehold } from "../../src/lib/HouseholdProvider";
import { useHouseholdMembers } from "../../src/lib/useHouseholdMembers";
import { useTeams } from "../../src/lib/useTeams";
import { colors } from "../../src/lib/theme";
import { Button, Chip, Empty, Loading, Screen, UndoToast } from "../../src/components/ui";
import type { Task, TaskOccurrence } from "../../src/types/database";

type Occurrence = TaskOccurrence & { tasks: Pick<Task, "title" | "points" | "assignment_mode"> };

function formatDue(dueDate: string): string {
  const due = new Date(`${dueDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);

  if (days === 0) return "heute fällig";
  if (days === 1) return "morgen fällig";
  if (days === -1) return "1 Tag überfällig";
  if (days < 0) return `${Math.abs(days)} Tage überfällig`;
  return `in ${days} Tagen`;
}

export default function TasksScreen() {
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);
  const { teams } = useTeams(activeHousehold?.id);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyMine, setOnlyMine] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ id: string; title: string } | null>(null);

  const load = useCallback(async () => {
    if (!activeHousehold) return;
    const { data, error } = await supabase
      .from("task_occurrences")
      .select("*, tasks(title, points, assignment_mode)")
      .eq("household_id", activeHousehold.id)
      .eq("status", "open")
      .order("due_date", { ascending: true });

    if (error) console.error(error);
    setOccurrences((data as Occurrence[]) ?? []);
    setLoading(false);
  }, [activeHousehold]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const myTeamIds = useMemo(
    () => teams.filter((t) => t.member_ids.includes(session?.user.id ?? "")).map((t) => t.id),
    [teams, session]
  );

  const visible = useMemo(() => {
    if (!onlyMine) return occurrences;
    return occurrences.filter(
      (o) =>
        o.assigned_to === session?.user.id ||
        (o.assigned_team_id && myTeamIds.includes(o.assigned_team_id)) ||
        (!o.assigned_to && !o.assigned_team_id)
    );
  }, [occurrences, onlyMine, session, myTeamIds]);

  const assigneeLabel = (occurrence: Occurrence) => {
    if (occurrence.assigned_to) {
      const isMe = occurrence.assigned_to === session?.user.id;
      const name = members.find((m) => m.id === occurrence.assigned_to)?.full_name ?? "?";
      return isMe ? "Du bist dran" : name;
    }
    if (occurrence.assigned_team_id) {
      const team = teams.find((t) => t.id === occurrence.assigned_team_id);
      return team ? `Team ${team.name}` : "Team";
    }
    return "Wer mag";
  };

  const markDone = async (occurrence: Occurrence) => {
    setBusyId(occurrence.id);
    const { error } = await supabase.rpc("complete_occurrence", {
      p_occurrence_id: occurrence.id,
    });
    setBusyId(null);
    if (error) {
      Alert.alert("Fehler", error.message);
      return;
    }
    setUndo({ id: occurrence.id, title: occurrence.tasks.title });
    load();
  };

  const undoDone = async () => {
    if (!undo) return;
    const { error } = await supabase.rpc("uncomplete_occurrence", { p_occurrence_id: undo.id });
    setUndo(null);
    if (error) {
      Alert.alert("Fehler", error.message);
      return;
    }
    load();
  };

  if (loading) return <Loading />;

  return (
    <Screen>
      <View style={styles.filterRow}>
        <Chip label="Alle" selected={!onlyMine} onPress={() => setOnlyMine(false)} />
        <Chip label="Für mich" selected={onlyMine} onPress={() => setOnlyMine(true)} />
      </View>

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 10 }}
        ListEmptyComponent={
          <Empty>
            {onlyMine ? "Nichts für dich offen. 🎉" : "Keine offenen Aufgaben. Leg unten eine an."}
          </Empty>
        }
        renderItem={({ item }) => {
          const overdue = item.due_date < new Date().toISOString().slice(0, 10);
          return (
            <View style={[styles.card, overdue && styles.cardOverdue]}>
              <TouchableOpacity
                style={{ flex: 1, gap: 2 }}
                onPress={() => router.push(`/task/${item.task_id}`)}
              >
                <Text style={styles.title}>{item.tasks.title}</Text>
                <Text style={[styles.meta, overdue && { color: colors.danger }]}>
                  {formatDue(item.due_date)} · {assigneeLabel(item)} · {item.tasks.points} Pkt
                </Text>
              </TouchableOpacity>
              <Button
                title="Erledigt"
                variant="success"
                loading={busyId === item.id}
                onPress={() => markDone(item)}
              />
            </View>
          );
        }}
      />

      <TouchableOpacity style={styles.fab} onPress={() => router.push("/new-task")}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <UndoToast
        message={undo ? `„${undo.title}" erledigt` : null}
        onUndo={undoDone}
        onHide={() => setUndo(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  filterRow: { flexDirection: "row", gap: 8, padding: 16, paddingBottom: 8 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderColor: colors.border,
    borderWidth: 1,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  cardOverdue: { borderColor: colors.danger },
  title: { fontSize: 16, fontWeight: "600", color: colors.text },
  meta: { fontSize: 13, color: colors.subtext },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    backgroundColor: colors.primary,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    elevation: 4,
  },
  fabText: { color: "#fff", fontSize: 28, lineHeight: 30 },
});
