import { useCallback, useEffect, useMemo, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/lib/AuthProvider";
import { useHousehold } from "../../src/lib/HouseholdProvider";
import { FORMER_MEMBER, useHouseholdMembers } from "../../src/lib/useHouseholdMembers";
import { useTeams } from "../../src/lib/useTeams";
import { makeStyles, useColors } from "../../src/lib/theme";
import {
  WEEKDAY_HEADER,
  formatLong,
  formatMonth,
  formatShort,
  formatTime,
  isInMonth,
  monthGrid,
  todayISO,
} from "../../src/lib/dates";
import { EVENT_KINDS } from "../../src/lib/eventKinds";
import { layoutWeek, type SpanItem } from "../../src/lib/calendarLayout";
import { Loading, UndoToast } from "../../src/components/ui";
import type {
  Absence,
  CalendarEvent,
  CalendarEventAttendee,
  Task,
  TaskOccurrence,
} from "../../src/types/database";

type Chore = TaskOccurrence & { tasks: Pick<Task, "title"> };

const MAX_LANES = 3;
const LANE_HEIGHT = 16;
/** Höhe von Tageszahl und Aufgabenpunkt über den Balken */
const DAY_AREA = 38;

export default function CalendarScreen() {
  const styles = useStyles();
  const colors = useColors();
  const dot = { event: colors.tint, absence: colors.absenceAccent, chore: colors.successText };
  // Heller (bzw. im Dunkelmodus gedämpfter) Grundton der Balken, Schrift bleibt lesbar
  const tint = { event: colors.eventTint, absence: colors.absenceTint };
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);
  const { teams } = useTeams(activeHousehold?.id);

  const today = todayISO();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selected, setSelected] = useState(today);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [attendees, setAttendees] = useState<CalendarEventAttendee[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [chores, setChores] = useState<Chore[]>([]);
  const [loading, setLoading] = useState(true);
  const [undo, setUndo] = useState<Absence | null>(null);

  const grid = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const rangeStart = grid[0];
  const rangeEnd = grid[grid.length - 1];

  const load = useCallback(async () => {
    if (!activeHousehold) return;

    const [eventResult, absenceResult, choreResult] = await Promise.all([
      supabase
        .from("calendar_events")
        .select("*")
        .eq("household_id", activeHousehold.id)
        .lte("starts_on", rangeEnd)
        .gte("ends_on", rangeStart)
        .order("starts_on")
        .order("start_time", { nullsFirst: true }),
      supabase
        .from("absences")
        .select("*")
        .eq("household_id", activeHousehold.id)
        .lte("start_date", rangeEnd)
        .gte("end_date", rangeStart),
      supabase
        .from("task_occurrences")
        .select("*, tasks(title)")
        .eq("household_id", activeHousehold.id)
        .eq("status", "open")
        .gte("due_date", rangeStart)
        .lte("due_date", rangeEnd),
    ]);

    const loadedEvents = (eventResult.data as CalendarEvent[]) ?? [];
    setEvents(loadedEvents);
    setAbsences((absenceResult.data as Absence[]) ?? []);
    setChores((choreResult.data as Chore[]) ?? []);

    if (loadedEvents.length > 0) {
      const { data } = await supabase
        .from("calendar_event_attendees")
        .select("*")
        .in(
          "event_id",
          loadedEvents.map((event) => event.id)
        );
      setAttendees((data as CalendarEventAttendee[]) ?? []);
    } else {
      setAttendees([]);
    }

    setLoading(false);
  }, [activeHousehold, rangeStart, rangeEnd]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    if (!activeHousehold) return;
    const channel = supabase
      .channel(`calendar:${activeHousehold.id}`)
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "calendar_events", filter: `household_id=eq.${activeHousehold.id}` },
        () => load()
      )
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "absences", filter: `household_id=eq.${activeHousehold.id}` },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeHousehold, load]);

  const myTeamIds = useMemo(
    () => teams.filter((team) => team.member_ids.includes(session?.user.id ?? "")).map((team) => team.id),
    [teams, session]
  );

  // Im Kalender nur die eigenen Putzaufgaben — "wer mag" würde jeden Tag zupflastern
  const myChores = useMemo(
    () =>
      chores.filter(
        (chore) =>
          chore.assigned_to === session?.user.id ||
          (chore.assigned_team_id !== null && myTeamIds.includes(chore.assigned_team_id))
      ),
    [chores, session, myTeamIds]
  );

  const nameFor = (userId: string) =>
    userId === session?.user.id ? "Du" : members.find((m) => m.id === userId)?.full_name ?? FORMER_MEMBER;

  const dayInfo = useCallback(
    (iso: string) => ({
      events: events.filter((event) => event.starts_on <= iso && event.ends_on >= iso),
      absences: absences.filter((absence) => absence.start_date <= iso && absence.end_date >= iso),
      chores: myChores.filter((chore) => chore.due_date === iso),
    }),
    [events, absences, myChores]
  );

  const weeks = useMemo(
    () => Array.from({ length: grid.length / 7 }, (_, index) => grid.slice(index * 7, index * 7 + 7)),
    [grid]
  );

  const spanItems = useMemo<SpanItem[]>(
    () => [
      ...events.map((event) => ({
        id: event.id,
        kind: "event" as const,
        start: event.starts_on,
        end: event.ends_on,
        label: event.title,
      })),
      ...absences.map((absence) => ({
        id: absence.id,
        kind: "absence" as const,
        start: absence.start_date,
        end: absence.end_date,
        label:
          absence.user_id === session?.user.id
            ? "Du"
            : members.find((member) => member.id === absence.user_id)?.full_name ?? FORMER_MEMBER,
      })),
    ],
    [events, absences, members, session]
  );

  const shiftMonth = (delta: number) => {
    setCursor((prev) => {
      const date = new Date(prev.year, prev.month + delta, 1);
      return { year: date.getFullYear(), month: date.getMonth() };
    });
  };

  const jumpToToday = () => {
    const now = new Date();
    setCursor({ year: now.getFullYear(), month: now.getMonth() });
    setSelected(today);
  };

  const removeAbsence = async (absence: Absence) => {
    setAbsences((prev) => prev.filter((entry) => entry.id !== absence.id));
    setUndo(absence);
    await supabase.from("absences").delete().eq("id", absence.id);
  };

  const undoRemove = async () => {
    if (!undo) return;
    await supabase.from("absences").insert({
      household_id: undo.household_id,
      user_id: undo.user_id,
      start_date: undo.start_date,
      end_date: undo.end_date,
      note: undo.note,
    });
    setUndo(null);
    load();
  };

  if (loading) return <Loading />;

  const selectedInfo = dayInfo(selected);
  const awayToday = dayInfo(today).absences;
  const isEmptyDay =
    selectedInfo.events.length + selectedInfo.absences.length + selectedInfo.chores.length === 0;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
        {awayToday.length > 0 && (
          <View style={styles.awayBanner}>
            <Ionicons name="airplane" size={14} color={dot.absence} />
            <Text style={styles.awayText}>
              Heute nicht da: {awayToday.map((absence) => nameFor(absence.user_id)).join(", ")}
            </Text>
          </View>
        )}

        <View style={styles.monthHeader}>
          <TouchableOpacity onPress={() => shiftMonth(-1)} style={styles.monthButton}>
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.monthTitle}>{formatMonth(cursor.year, cursor.month)}</Text>
          <TouchableOpacity onPress={() => shiftMonth(1)} style={styles.monthButton}>
            <Ionicons name="chevron-forward" size={20} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={jumpToToday} style={styles.todayButton}>
            <Text style={styles.todayButtonText}>Heute</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.weekHeader}>
          {WEEKDAY_HEADER.map((day) => (
            <Text key={day} style={styles.weekHeaderText}>
              {day}
            </Text>
          ))}
        </View>

        <View style={styles.grid}>
          {weeks.map((weekDays) => {
            const layout = layoutWeek(spanItems, weekDays, MAX_LANES);
            const hasHidden = layout.hidden.some((count) => count > 0);
            const rowHeight = Math.max(
              48,
              DAY_AREA + layout.laneCount * LANE_HEIGHT + (hasHidden ? 13 : 0) + 4
            );

            return (
              <View key={weekDays[0]} style={[styles.week, { height: rowHeight }]}>
                {weekDays.map((iso) => {
                  const inMonth = isInMonth(iso, cursor.year, cursor.month);
                  const isToday = iso === today;
                  const isSelected = iso === selected;
                  const hasChore = myChores.some((chore) => chore.due_date === iso);
                  return (
                    <TouchableOpacity
                      key={iso}
                      style={styles.cell}
                      onPress={() => {
                        setSelected(iso);
                        if (!inMonth) {
                          const date = new Date(`${iso}T12:00:00`);
                          setCursor({ year: date.getFullYear(), month: date.getMonth() });
                        }
                      }}
                    >
                      <View
                        style={[
                          styles.dayCircle,
                          isToday && styles.dayToday,
                          isSelected && styles.daySelected,
                        ]}
                      >
                        <Text
                          style={[
                            styles.dayNumber,
                            !inMonth && styles.dayOutside,
                            isSelected && styles.dayNumberSelected,
                          ]}
                        >
                          {Number(iso.slice(8, 10))}
                        </Text>
                      </View>
                      <View style={[styles.choreDot, hasChore && { backgroundColor: dot.chore }]} />
                    </TouchableOpacity>
                  );
                })}

                {/* Balken über den Tageszellen; Tipps gehen durch sie hindurch an den Tag */}
                <View style={[StyleSheet.absoluteFill, { pointerEvents: "none" }]}>
                  {layout.segments.map((segment) => {
                    const accent = segment.kind === "event" ? dot.event : dot.absence;
                    return (
                      <View
                        key={`${segment.id}-${weekDays[0]}`}
                        style={[
                          styles.bar,
                          {
                            top: DAY_AREA + segment.lane * LANE_HEIGHT,
                            left: `${(segment.startCol / 7) * 100}%`,
                            width: `${((segment.endCol - segment.startCol + 1) / 7) * 100}%`,
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.barFill,
                            { backgroundColor: tint[segment.kind] },
                            // Gerade Kante, wo der Eintrag in die Nachbarwoche weiterläuft
                            !segment.continuesLeft && [
                              styles.barStart,
                              { borderLeftColor: accent },
                            ],
                            !segment.continuesRight && styles.barEnd,
                          ]}
                        >
                          {segment.kind === "absence" && (
                            <Ionicons name="airplane" size={9} color={colors.text} />
                          )}
                          <Text numberOfLines={1} style={styles.barText}>
                            {segment.label}
                          </Text>
                        </View>
                      </View>
                    );
                  })}

                  {layout.hidden.map((count, col) =>
                    count > 0 ? (
                      <Text
                        key={`more-${col}`}
                        style={[
                          styles.moreText,
                          {
                            left: `${(col / 7) * 100}%`,
                            top: DAY_AREA + layout.laneCount * LANE_HEIGHT,
                          },
                        ]}
                      >
                        +{count}
                      </Text>
                    ) : null
                  )}
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.legend}>
          <LegendBar tint={tint.event} accent={dot.event} label="Termin" />
          <LegendBar tint={tint.absence} accent={dot.absence} label="Abwesend" />
          <Legend color={dot.chore} label="Deine Aufgabe" />
        </View>

        <View style={styles.dayPanel}>
          <Text style={styles.dayTitle}>{formatLong(selected)}</Text>

          {isEmptyDay && <Text style={styles.emptyDay}>Nichts eingetragen.</Text>}

          {selectedInfo.events.map((event) => {
            const kind = EVENT_KINDS[event.kind];
            const yes = attendees.filter((entry) => entry.event_id === event.id && entry.status === "yes");
            const time = formatTime(event.start_time);
            const endTime = formatTime(event.end_time);
            return (
              <TouchableOpacity
                key={event.id}
                style={styles.entry}
                onPress={() => router.push(`/event/${event.id}`)}
              >
                <Ionicons name={kind.icon} size={18} color={dot.event} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.entryTitle}>{event.title}</Text>
                  <Text style={styles.entryMeta}>
                    {time ? `${time}${endTime ? `–${endTime}` : ""} Uhr` : "ganztägig"}
                    {event.starts_on !== event.ends_on
                      ? ` · ${formatShort(event.starts_on)} – ${formatShort(event.ends_on)}`
                      : ""}
                    {/* Als Label statt Satz — "Du macht auf" wäre falsch konjugiert */}
                    {yes.length > 0
                      ? ` · ${kind.attendeeVerb}: ${yes.map((entry) => nameFor(entry.user_id)).join(", ")}`
                      : ""}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.subtext} />
              </TouchableOpacity>
            );
          })}

          {selectedInfo.absences.map((absence) => (
            <View key={absence.id} style={styles.entry}>
              <Ionicons name="airplane" size={18} color={dot.absence} />
              <View style={{ flex: 1 }}>
                <Text style={styles.entryTitle}>
                  {absence.user_id === session?.user.id ? "Du bist weg" : `${nameFor(absence.user_id)} ist weg`}
                </Text>
                <Text style={styles.entryMeta}>
                  {absence.start_date === absence.end_date
                    ? "ganztägig"
                    : `${formatShort(absence.start_date)} – ${formatShort(absence.end_date)}`}
                  {absence.note ? ` · ${absence.note}` : ""}
                </Text>
              </View>
              {absence.user_id === session?.user.id && (
                <TouchableOpacity onPress={() => removeAbsence(absence)} style={styles.iconButton}>
                  <Ionicons name="trash-outline" size={17} color={colors.subtext} />
                </TouchableOpacity>
              )}
            </View>
          ))}

          {selectedInfo.chores.map((chore) => (
            <TouchableOpacity
              key={chore.id}
              style={styles.entry}
              onPress={() => router.push(`/task/${chore.task_id}`)}
            >
              <Ionicons name="sparkles" size={18} color={dot.chore} />
              <View style={{ flex: 1 }}>
                <Text style={styles.entryTitle}>{chore.tasks.title}</Text>
                <Text style={styles.entryMeta}>Du bist dran</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.subtext} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {!undo && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.actionPrimary]}
            onPress={() => router.push({ pathname: "/new-event", params: { date: selected } })}
          >
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={styles.actionPrimaryText}>Termin</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => router.push({ pathname: "/new-absence", params: { date: selected } })}
          >
            <Ionicons name="airplane-outline" size={18} color={colors.text} />
            <Text style={styles.actionText}>Ich bin weg</Text>
          </TouchableOpacity>
        </View>
      )}

      <UndoToast
        message={undo ? "Abwesenheit gelöscht" : null}
        onUndo={undoRemove}
        onHide={() => setUndo(null)}
      />
    </View>
  );
}

function LegendBar({ tint, accent, label }: { tint: string; accent: string; label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendBar, { backgroundColor: tint, borderLeftColor: accent }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  awayBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  awayText: { fontSize: 13, color: colors.text },
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 6,
    gap: 4,
  },
  monthButton: { padding: 6 },
  monthTitle: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "700", color: colors.text },
  todayButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginLeft: 4,
  },
  todayButtonText: { fontSize: 13, fontWeight: "600", color: colors.tint },
  weekHeader: { flexDirection: "row", paddingHorizontal: 8 },
  weekHeaderText: {
    flex: 1,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "600",
    color: colors.subtext,
    paddingVertical: 4,
  },
  grid: { paddingHorizontal: 8 },
  week: { flexDirection: "row", position: "relative" },
  // Zelle über die volle Zeilenhöhe, damit auch Tipps auf einen Balken den Tag wählen
  cell: { flex: 1, alignItems: "center", paddingTop: 3 },
  choreDot: { width: 5, height: 5, borderRadius: 3, marginTop: 2 },
  bar: { position: "absolute", height: LANE_HEIGHT - 2 },
  barFill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 3,
    overflow: "hidden",
  },
  barStart: {
    marginLeft: 2,
    borderLeftWidth: 3,
    borderTopLeftRadius: 4,
    borderBottomLeftRadius: 4,
  },
  barEnd: { marginRight: 2, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  barText: { flex: 1, fontSize: 10, color: colors.text },
  moreText: {
    position: "absolute",
    width: `${100 / 7}%`,
    textAlign: "center",
    fontSize: 10,
    color: colors.subtext,
  },
  legendBar: { width: 16, height: 8, borderLeftWidth: 3, borderRadius: 2 },
  dayCircle: { width: 28, height: 28, borderRadius: 14, justifyContent: "center", alignItems: "center" },
  dayToday: { borderWidth: 1.5, borderColor: colors.primary },
  daySelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayNumber: { fontSize: 15, color: colors.text },
  dayOutside: { color: colors.border },
  dayNumberSelected: { color: "#fff", fontWeight: "700" },
  dot: { width: 6, height: 6, borderRadius: 3 },
  legend: { flexDirection: "row", justifyContent: "center", gap: 14, paddingVertical: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendText: { fontSize: 12, color: colors.subtext },
  dayPanel: {
    marginHorizontal: 16,
    marginTop: 4,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  dayTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  emptyDay: { fontSize: 14, color: colors.subtext },
  entry: { flexDirection: "row", alignItems: "center", gap: 10 },
  entryTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  entryMeta: { fontSize: 13, color: colors.subtext, marginTop: 1 },
  iconButton: { padding: 6 },
  actions: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 16,
    flexDirection: "row",
    gap: 10,
  },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  actionText: { fontSize: 15, fontWeight: "600", color: colors.text },
  actionPrimaryText: { fontSize: 15, fontWeight: "600", color: "#fff" },
}));
