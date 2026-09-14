import { useCallback, useEffect, useMemo, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { Alert, FlatList, SectionList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/lib/AuthProvider";
import { useHousehold } from "../../src/lib/HouseholdProvider";
import { FORMER_MEMBER, useHouseholdMembers } from "../../src/lib/useHouseholdMembers";
import { useTeams } from "../../src/lib/useTeams";
import { usePlaceholders } from "../../src/lib/usePlaceholders";
import { makeStyles, useColors } from "../../src/lib/theme";
import { addDays, formatShort, todayISO, weekLabel } from "../../src/lib/dates";
import { Button, Chip, Empty, Loading, Screen, UndoToast } from "../../src/components/ui";
import { rhythmLabel } from "../../src/lib/taskLabels";
import { PushPrompt } from "../../src/components/PushPrompt";
import type { Task, TaskOccurrence, TaskRotationEntry } from "../../src/types/database";

type Occurrence = TaskOccurrence & {
  tasks: Pick<Task, "title" | "points" | "assignment_mode">;
};

type TaskView = "alle" | "meine" | "plan" | "routinen";

type Routine = Task & { task_rotation: TaskRotationEntry[] };

function formatDue(dueDate: string): string {
  const due = new Date(`${dueDate}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);

  if (days === 0) return "heute fällig";
  if (days === 1) return "morgen fällig";
  if (days === -1) return "1 Tag überfällig";
  if (days < 0) return `${Math.abs(days)} Tage überfällig`;
  if (days <= 6) return `in ${days} Tagen`;
  return formatShort(dueDate);
}

export default function TasksScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);
  const { teams } = useTeams(activeHousehold?.id);
  const { placeholders } = usePlaceholders(activeHousehold?.id);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<TaskView>("alle");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ id: string; title: string } | null>(null);

  const load = useCallback(async () => {
    if (!activeHousehold) return;
    const [occurrenceResult, routineResult] = await Promise.all([
      supabase
        .from("task_occurrences")
        .select("*, tasks(title, points, assignment_mode)")
        .eq("household_id", activeHousehold.id)
        .eq("status", "open")
        .order("due_date", { ascending: true }),
      supabase
        .from("tasks")
        .select("*, task_rotation(*)")
        .eq("household_id", activeHousehold.id)
        .order("title"),
    ]);

    if (occurrenceResult.error) console.error(occurrenceResult.error);
    if (routineResult.error) console.error(routineResult.error);
    setOccurrences((occurrenceResult.data as Occurrence[]) ?? []);
    setRoutines((routineResult.data as Routine[]) ?? []);
    setLoading(false);
  }, [activeHousehold]);

  // Plan bis zum Horizont auffüllen — ohne das würde eine liegengebliebene
  // Aufgabe die gesamte Rotation blockieren.
  useEffect(() => {
    if (!activeHousehold) return;
    supabase
      .rpc("ensure_occurrences", { p_household_id: activeHousehold.id, p_horizon_days: 28 })
      .then(({ error }) => {
        if (error) console.error(error);
        load();
      });
  }, [activeHousehold, load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const myTeamIds = useMemo(
    () => teams.filter((t) => t.member_ids.includes(session?.user.id ?? "")).map((t) => t.id),
    [teams, session]
  );

  const isMine = useCallback(
    (occurrence: Occurrence) =>
      occurrence.assigned_to === session?.user.id ||
      (occurrence.assigned_team_id !== null && myTeamIds.includes(occurrence.assigned_team_id)) ||
      // "Wer mag" nur, wenn wirklich niemand zugeteilt ist — auch kein Platzhalter
      (!occurrence.assigned_to && !occurrence.assigned_team_id && !occurrence.assigned_placeholder_id),
    [session, myTeamIds]
  );

  const sections = useMemo(() => {
    if (view === "plan") {
      const byWeek = new Map<string, Occurrence[]>();
      for (const occurrence of occurrences) {
        const label = weekLabel(occurrence.due_date);
        const bucket = byWeek.get(label);
        if (bucket) bucket.push(occurrence);
        else byWeek.set(label, [occurrence]);
      }
      return [...byWeek.entries()].map(([title, data]) => ({ title, data }));
    }

    // Alltagsansicht: was jetzt ansteht, nicht der ganze Monat
    const horizon = addDays(todayISO(), 7);
    const soon = occurrences.filter((occurrence) => occurrence.due_date <= horizon);
    const visible = view === "meine" ? soon.filter(isMine) : soon;
    return visible.length > 0 ? [{ title: "", data: visible }] : [];
  }, [occurrences, view, isMine]);

  const assigneeLabel = (occurrence: Occurrence) => {
    if (occurrence.assigned_to) {
      const isMe = occurrence.assigned_to === session?.user.id;
      return isMe ? "Du bist dran" : members.find((m) => m.id === occurrence.assigned_to)?.full_name ?? FORMER_MEMBER;
    }
    if (occurrence.assigned_team_id) {
      const team = teams.find((t) => t.id === occurrence.assigned_team_id);
      return team ? `Team ${team.name}` : "Team";
    }
    if (occurrence.assigned_placeholder_id) {
      const placeholder = placeholders.find((entry) => entry.id === occurrence.assigned_placeholder_id);
      return placeholder ? `${placeholder.name} (noch nicht dabei)` : "Wer mag";
    }
    return "Wer mag";
  };

  // Nächster offener Termin je Aufgabe (occurrences sind nach Datum sortiert)
  const nextByTask = useMemo(() => {
    const next = new Map<string, Occurrence>();
    for (const occurrence of occurrences) {
      if (!next.has(occurrence.task_id)) next.set(occurrence.task_id, occurrence);
    }
    return next;
  }, [occurrences]);

  // Aktive nach nächster Fälligkeit, pausierte ans Ende
  const sortedRoutines = useMemo(
    () =>
      [...routines].sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        const dueA = nextByTask.get(a.id)?.due_date ?? "9999-12-31";
        const dueB = nextByTask.get(b.id)?.due_date ?? "9999-12-31";
        return dueA.localeCompare(dueB) || a.title.localeCompare(b.title);
      }),
    [routines, nextByTask]
  );

  const rotationName = (entry: TaskRotationEntry) => {
    if (entry.user_id) {
      return entry.user_id === session?.user.id
        ? "Du"
        : members.find((member) => member.id === entry.user_id)?.full_name ?? FORMER_MEMBER;
    }
    if (entry.team_id) {
      return `Team ${teams.find((team) => team.id === entry.team_id)?.name ?? "?"}`;
    }
    return placeholders.find((placeholder) => placeholder.id === entry.placeholder_id)?.name ?? "?";
  };

  const assignmentSummary = (routine: Routine) => {
    if (routine.assignment_mode === "anyone") return "Wer mag";
    if (routine.assignment_mode === "fixed") {
      const fixed =
        routine.fixed_assignee === session?.user.id
          ? "Du"
          : members.find((member) => member.id === routine.fixed_assignee)?.full_name ?? FORMER_MEMBER;
      return `Immer: ${fixed}`;
    }
    const order = [...routine.task_rotation].sort((a, b) => a.position - b.position);
    return order.length > 0 ? `Reihum: ${order.map(rotationName).join(" → ")}` : "Reihum (niemand eingetragen)";
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

  const emptyText =
    view === "meine"
      ? "Nichts für dich offen. 🎉"
      : view === "plan"
        ? "Noch keine Aufgaben geplant."
        : "Diese Woche ist nichts offen.";

  return (
    <Screen>
      <View style={styles.filterRow}>
        <Chip label="Alle" selected={view === "alle"} onPress={() => setView("alle")} />
        <Chip label="Für mich" selected={view === "meine"} onPress={() => setView("meine")} />
        <Chip label="Plan" selected={view === "plan"} onPress={() => setView("plan")} />
        <Chip label="Routinen" selected={view === "routinen"} onPress={() => setView("routinen")} />
      </View>

      <PushPrompt />

      {view === "routinen" ? (
        <FlatList
          data={sortedRoutines}
          keyExtractor={(routine) => routine.id}
          contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 90, gap: 10 }}
          ListHeaderComponent={
            routines.length > 0 ? (
              <Text style={styles.routineCount}>
                {routines.length} {routines.length === 1 ? "Routine" : "Routinen"}
                {routines.some((routine) => !routine.active)
                  ? ` · ${routines.filter((routine) => !routine.active).length} pausiert`
                  : ""}
              </Text>
            ) : null
          }
          ListEmptyComponent={<Empty>Noch keine Routinen. Leg unten eine an.</Empty>}
          renderItem={({ item: routine }) => {
            const next = nextByTask.get(routine.id);
            return (
              <TouchableOpacity
                style={[styles.routineCard, !routine.active && styles.routinePaused]}
                onPress={() => router.push(`/task/${routine.id}`)}
              >
                <View style={styles.routineHeader}>
                  <Text style={styles.title}>{routine.title}</Text>
                  {routine.active ? (
                    <Text style={styles.meta}>{routine.points} Pkt</Text>
                  ) : (
                    <View style={styles.pausedBadge}>
                      <Text style={styles.pausedBadgeText}>Pausiert</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.meta}>{rhythmLabel(routine.interval_days, routine.weekday)}</Text>
                <Text style={styles.meta} numberOfLines={2}>
                  {assignmentSummary(routine)}
                </Text>
                {routine.active && next && (
                  <Text style={styles.routineNext}>
                    Als Nächstes: {formatDue(next.due_date)} · {assigneeLabel(next)}
                  </Text>
                )}
              </TouchableOpacity>
            );
          }}
        />
      ) : (
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 90 }}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={<Empty>{emptyText}</Empty>}
        renderSectionHeader={({ section }) =>
          section.title ? <Text style={styles.sectionTitle}>{section.title}</Text> : null
        }
        renderItem={({ item }) => {
          const overdue = item.due_date < todayISO();
          const mine = isMine(item);
          return (
            <View style={[styles.card, overdue && styles.cardOverdue]}>
              <TouchableOpacity
                style={{ flex: 1, gap: 2 }}
                onPress={() => router.push(`/task/${item.task_id}`)}
              >
                <Text style={styles.title}>{item.tasks.title}</Text>
                <Text style={[styles.meta, overdue && { color: colors.dangerText }]}>
                  {formatDue(item.due_date)} · {assigneeLabel(item)} · {item.tasks.points} Pkt
                </Text>
              </TouchableOpacity>
              <Button
                title="Erledigt"
                variant={mine ? "success" : "secondary"}
                loading={busyId === item.id}
                onPress={() => markDone(item)}
              />
            </View>
          );
        }}
      />
      )}

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

const useStyles = makeStyles((colors) => ({
  filterRow: { flexDirection: "row", gap: 8, padding: 16, paddingBottom: 8 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.subtext,
    textTransform: "uppercase",
    paddingTop: 14,
    paddingBottom: 6,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderColor: colors.border,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  cardOverdue: { borderColor: colors.danger },
  title: { fontSize: 16, fontWeight: "600", color: colors.text, flexShrink: 1 },
  meta: { fontSize: 13, color: colors.subtext },
  routineCount: { fontSize: 13, color: colors.subtext, paddingBottom: 2 },
  routineCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderColor: colors.border,
    borderWidth: 1,
    padding: 14,
    gap: 3,
  },
  routinePaused: { opacity: 0.6 },
  routineHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  routineNext: { fontSize: 13, color: colors.text, marginTop: 4 },
  pausedBadge: {
    borderRadius: 999,
    backgroundColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pausedBadgeText: { fontSize: 12, fontWeight: "600", color: colors.subtext },
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
}));
