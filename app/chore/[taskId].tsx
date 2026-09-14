import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Platform, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/lib/AuthProvider";
import { useHousehold } from "../../src/lib/HouseholdProvider";
import { FORMER_MEMBER, useHouseholdMembers } from "../../src/lib/useHouseholdMembers";
import { useTeams } from "../../src/lib/useTeams";
import { usePlaceholders } from "../../src/lib/usePlaceholders";
import { makeStyles, useColors } from "../../src/lib/theme";
import { formatLong } from "../../src/lib/dates";
import { hapticSuccess, hapticTap } from "../../src/lib/haptics";
import { emitChoreCompleted } from "../../src/lib/choreEvents";
import { Button, Card, Empty, Loading, Muted } from "../../src/components/ui";
import type { Task, TaskChecklistCheck, TaskChecklistItem, TaskOccurrence } from "../../src/types/database";

type Occurrence = TaskOccurrence & {
  tasks: Pick<Task, "id" | "title" | "points" | "description"> & { task_checklist_items: TaskChecklistItem[] };
};

/**
 * Eine anstehende Aufgabe abarbeiten: Notiz lesen, Checkliste abhaken, erledigen.
 * Adressiert über Aufgabe + Datum, damit ein Neuplanen den Bildschirm nicht ins Leere laufen lässt.
 */
export default function ChoreScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { taskId, date } = useLocalSearchParams<{ taskId: string; date: string }>();
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);
  const { teams } = useTeams(activeHousehold?.id);
  const { placeholders } = usePlaceholders(activeHousehold?.id);
  const [occurrence, setOccurrence] = useState<Occurrence | null>(null);
  const [checks, setChecks] = useState<TaskChecklistCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const celebrated = useRef(false);

  // Beim Putzen liegt das Handy daneben — der Bildschirm soll nicht ständig ausgehen
  useEffect(() => {
    if (Platform.OS === "web") return;
    activateKeepAwakeAsync("chore").catch(() => {});
    return () => {
      deactivateKeepAwake("chore").catch(() => {});
    };
  }, []);

  const loadChecks = useCallback(async () => {
    if (!taskId || !date) return;
    const { data } = await supabase
      .from("task_checklist_checks")
      .select("*")
      .eq("task_id", taskId)
      .eq("due_date", date);
    setChecks((data as TaskChecklistCheck[]) ?? []);
  }, [taskId, date]);

  const load = useCallback(async () => {
    if (!taskId || !date) return;
    const { data } = await supabase
      .from("task_occurrences")
      .select("*, tasks(id, title, points, description, task_checklist_items!task_checklist_items_task_id_fkey(*))")
      .eq("task_id", taskId)
      .eq("due_date", date)
      .limit(1);
    setOccurrence(((data as Occurrence[]) ?? [])[0] ?? null);
    await loadChecks();
    setLoading(false);
  }, [taskId, date, loadChecks]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Wer zu zweit putzt, sieht die Haken der anderen sofort
  useEffect(() => {
    if (!taskId) return;
    const channel = supabase
      .channel(`chore:${taskId}:${date}`)
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "task_checklist_checks", filter: `task_id=eq.${taskId}` },
        () => loadChecks()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [taskId, date, loadChecks]);

  const items = useMemo(
    () => [...(occurrence?.tasks.task_checklist_items ?? [])].sort((a, b) => a.position - b.position),
    [occurrence]
  );
  const checkedIds = useMemo(() => new Set(checks.map((check) => check.item_id)), [checks]);
  const doneCount = items.filter((item) => checkedIds.has(item.id)).length;
  const allDone = items.length > 0 && doneCount === items.length;

  if (loading || !session) return <Loading />;

  if (!occurrence) {
    return (
      <View style={styles.container}>
        <Empty>Diesen Termin gibt es nicht mehr — vielleicht wurde der Plan neu verteilt.</Empty>
      </View>
    );
  }

  const nameFor = (userId: string | null) =>
    userId === session.user.id ? "Du" : members.find((member) => member.id === userId)?.full_name ?? FORMER_MEMBER;

  const assignee = occurrence.assigned_to
    ? occurrence.assigned_to === session.user.id
      ? "Du bist dran"
      : `${nameFor(occurrence.assigned_to)} ist dran`
    : occurrence.assigned_team_id
      ? `Team ${teams.find((team) => team.id === occurrence.assigned_team_id)?.name ?? ""} ist dran`
      : occurrence.assigned_placeholder_id
        ? `${placeholders.find((entry) => entry.id === occurrence.assigned_placeholder_id)?.name ?? "?"} ist dran`
        : "Wer mag";

  const toggle = async (item: TaskChecklistItem) => {
    const isChecked = checkedIds.has(item.id);
    if (isChecked) {
      setChecks((prev) => prev.filter((check) => check.item_id !== item.id));
      hapticTap();
      await supabase
        .from("task_checklist_checks")
        .delete()
        .eq("task_id", occurrence.task_id)
        .eq("due_date", occurrence.due_date)
        .eq("item_id", item.id);
      return;
    }

    const willBeComplete = doneCount + 1 === items.length;
    setChecks((prev) => [
      ...prev,
      {
        task_id: occurrence.task_id,
        due_date: occurrence.due_date,
        item_id: item.id,
        checked_by: session.user.id,
        checked_at: new Date().toISOString(),
      },
    ]);
    if (willBeComplete && !celebrated.current) {
      celebrated.current = true;
      hapticSuccess();
    } else {
      hapticTap();
    }

    const { error } = await supabase.from("task_checklist_checks").insert({
      task_id: occurrence.task_id,
      due_date: occurrence.due_date,
      item_id: item.id,
      checked_by: session.user.id,
    });
    // Hat jemand anderes gleichzeitig abgehakt, zählt dessen Haken
    if (error) loadChecks();
  };

  const complete = async () => {
    setCompleting(true);
    const { error } = await supabase.rpc("complete_occurrence", { p_occurrence_id: occurrence.id });
    setCompleting(false);
    if (error) {
      load();
      return;
    }
    hapticSuccess();
    emitChoreCompleted({ occurrenceId: occurrence.id, title: occurrence.tasks.title });
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/tasks");
  };

  const isOpen = occurrence.status === "open";

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: occurrence.tasks.title,
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.push(`/task/${occurrence.task_id}`)}
              style={{ paddingHorizontal: 8 }}
              accessibilityLabel="Routine bearbeiten"
            >
              <Ionicons name="create-outline" size={22} color={colors.tint} />
            </TouchableOpacity>
          ),
        }}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.summary}>
          <Text style={styles.summaryDate}>{formatLong(occurrence.due_date)}</Text>
          <Text style={styles.summaryMeta}>
            {assignee} · {occurrence.tasks.points} Pkt
          </Text>
        </View>

        {occurrence.tasks.description && (
          <Card style={styles.noteCard}>
            <Ionicons name="document-text-outline" size={18} color={colors.subtext} />
            <Text style={styles.noteText}>{occurrence.tasks.description}</Text>
          </Card>
        )}

        {items.length > 0 ? (
          <Card style={styles.listCard}>
            <View style={styles.listHeader}>
              <Text style={styles.listTitle}>Checkliste</Text>
              <Text style={styles.listCount}>
                {doneCount} von {items.length}
              </Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${(doneCount / items.length) * 100}%` }]} />
            </View>

            {items.map((item) => {
              const check = checks.find((entry) => entry.item_id === item.id);
              return (
                <TouchableOpacity
                  key={item.id}
                  style={styles.item}
                  onPress={() => toggle(item)}
                  disabled={!isOpen}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: Boolean(check) }}
                >
                  <Ionicons
                    name={check ? "checkbox" : "square-outline"}
                    size={24}
                    color={check ? colors.successText : colors.subtext}
                  />
                  <Text style={[styles.itemLabel, check && styles.itemDone]}>{item.label}</Text>
                  {check && check.checked_by !== session.user.id && (
                    <Text style={styles.itemBy}>{nameFor(check.checked_by)}</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </Card>
        ) : (
          <Card>
            <Muted>Diese Routine hat noch keine Checkliste.</Muted>
            <TouchableOpacity onPress={() => router.push(`/task/${occurrence.task_id}`)}>
              <Text style={styles.link}>Checkliste anlegen</Text>
            </TouchableOpacity>
          </Card>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {isOpen ? (
          <>
            {allDone && <Text style={styles.allDone}>Alles abgehakt 🎉</Text>}
            <Button title="Erledigt" variant="success" onPress={complete} loading={completing} />
          </>
        ) : (
          <Text style={styles.doneState}>
            Erledigt{occurrence.completed_by ? ` von ${nameFor(occurrence.completed_by)}` : ""}
          </Text>
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 12, paddingBottom: 24 },
  summary: { gap: 2, paddingHorizontal: 2 },
  summaryDate: { fontSize: 15, fontWeight: "600", color: colors.text },
  summaryMeta: { fontSize: 14, color: colors.subtext },
  noteCard: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  noteText: { flex: 1, fontSize: 15, lineHeight: 21, color: colors.text },
  listCard: { gap: 0, paddingVertical: 10 },
  listHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  listTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  listCount: { fontSize: 13, color: colors.subtext },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: 8,
    marginBottom: 4,
    overflow: "hidden",
  },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: colors.success },
  item: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11 },
  itemLabel: { flex: 1, fontSize: 16, color: colors.text },
  itemDone: { color: colors.subtext, textDecorationLine: "line-through" },
  itemBy: { fontSize: 12, color: colors.subtext },
  link: { color: colors.tint, fontWeight: "600", marginTop: 4 },
  footer: {
    padding: 16,
    paddingBottom: 28,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  allDone: { textAlign: "center", fontSize: 15, fontWeight: "600", color: colors.successText },
  doneState: { textAlign: "center", fontSize: 15, color: colors.subtext },
}));
