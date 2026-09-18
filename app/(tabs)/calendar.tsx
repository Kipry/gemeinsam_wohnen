import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../src/lib/supabase";
import { useRefresh } from "../../src/lib/useRefresh";
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
import { onReconnect } from "../../src/lib/connectivity";
import { useOfflineSnapshot } from "../../src/lib/offlineCache";
import { EVENT_KINDS } from "../../src/lib/eventKinds";
import { layoutWeek, type SpanItem } from "../../src/lib/calendarLayout";
import { mergeAbsences, type AbsenceBlock } from "../../src/lib/absences";
import { useWaste } from "../../src/lib/useWaste";
import { collectionsBetween, rhythmText } from "../../src/lib/waste";
import { Loading, pullToRefresh, UndoToast } from "../../src/components/ui";
import type {
  Absence,
  CalendarEvent,
  CalendarEventAttendee,
  Task,
  TaskOccurrence,
} from "../../src/types/database";

type Chore = TaskOccurrence & { tasks: Pick<Task, "title"> };

type CalendarSnapshot = {
  events: CalendarEvent[];
  absences: Absence[];
  chores: Chore[];
  attendees: CalendarEventAttendee[];
};

const MAX_LANES = 3;
const LANE_HEIGHT = 16;
/** Höhe von Tageszahl und Markierungen (Aufgabe, Tonnen) über den Balken */
const DAY_AREA = 44;
/** Mehr Tonnen-Symbole passen nicht sauber in eine Zelle */
const MAX_BIN_ICONS = 3;

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
  const [undo, setUndo] = useState<AbsenceBlock | null>(null);
  // Läuft das Löschen noch, wartet „Rückgängig" darauf — sonst überholt es das Löschen
  const pendingDelete = useRef<PromiseLike<unknown> | null>(null);

  const grid = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const rangeStart = grid[0];
  const rangeEnd = grid[grid.length - 1];
  const { bins, changes } = useWaste(activeHousehold?.id);
  const collections = useMemo(
    () => collectionsBetween(bins, changes, rangeStart, rangeEnd),
    [bins, changes, rangeStart, rangeEnd]
  );

  // Je angezeigtem Monat der letzte Stand fürs Funkloch
  const saveSnapshot = useOfflineSnapshot<CalendarSnapshot>(
    activeHousehold ? `calendar:${activeHousehold.id}:${rangeStart}` : null,
    (snapshot) => {
      setEvents(snapshot.events);
      setAbsences(snapshot.absences);
      setChores(snapshot.chores);
      setAttendees(snapshot.attendees);
      setLoading(false);
    }
  );

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

    if (eventResult.error || absenceResult.error || choreResult.error) {
      // Ohne Netz: beim angezeigten Stand bleiben
      console.error(eventResult.error ?? absenceResult.error ?? choreResult.error);
      setLoading(false);
      return;
    }

    const loadedEvents = (eventResult.data as CalendarEvent[]) ?? [];
    const loadedAbsences = (absenceResult.data as Absence[]) ?? [];
    const loadedChores = (choreResult.data as Chore[]) ?? [];
    setEvents(loadedEvents);
    setAbsences(loadedAbsences);
    setChores(loadedChores);

    let loadedAttendees: CalendarEventAttendee[] = [];
    if (loadedEvents.length > 0) {
      const { data } = await supabase
        .from("calendar_event_attendees")
        .select("*")
        .in(
          "event_id",
          loadedEvents.map((event) => event.id)
        );
      loadedAttendees = (data as CalendarEventAttendee[]) ?? [];
    }
    setAttendees(loadedAttendees);
    saveSnapshot({ events: loadedEvents, absences: loadedAbsences, chores: loadedChores, attendees: loadedAttendees });

    setLoading(false);
  }, [activeHousehold, rangeStart, rangeEnd, saveSnapshot]);

  useEffect(() => onReconnect(() => void load()), [load]);
  const { refreshing, onRefresh } = useRefresh(load);

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

  const absenceBlocks = useMemo(() => mergeAbsences(absences), [absences]);

  const nameFor = (userId: string) =>
    userId === session?.user.id ? "Du" : members.find((m) => m.id === userId)?.full_name ?? FORMER_MEMBER;

  const dayInfo = useCallback(
    (iso: string) => ({
      events: events.filter((event) => event.starts_on <= iso && event.ends_on >= iso),
      absences: absenceBlocks.filter((block) => block.start_date <= iso && block.end_date >= iso),
      chores: myChores.filter((chore) => chore.due_date === iso),
      // Ausgefallene bleiben in der Tagesansicht sichtbar, damit man sie zurückholen kann
      waste: collections.filter((entry) => entry.date === iso),
    }),
    [events, absenceBlocks, myChores, collections]
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
      ...absenceBlocks.map((block) => ({
        id: block.id,
        kind: "absence" as const,
        start: block.start_date,
        end: block.end_date,
        label:
          block.user_id === session?.user.id
            ? "Du"
            : members.find((member) => member.id === block.user_id)?.full_name ?? FORMER_MEMBER,
      })),
    ],
    [events, absenceBlocks, members, session]
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

  const removeAbsence = (block: AbsenceBlock) => {
    const ids = block.entries.map((entry) => entry.id);
    setAbsences((prev) => prev.filter((entry) => !ids.includes(entry.id)));
    setUndo(block);
    pendingDelete.current = supabase
      .from("absences")
      .delete()
      .in("id", ids)
      .then(({ error }) => {
        if (error) load();
      });
  };

  const undoRemove = async () => {
    const block = undo;
    if (!block) return;
    // Sofort ausblenden, damit ein zweiter Tipp nichts doppelt anlegt
    setUndo(null);
    await pendingDelete.current;
    const restored = block.entries.filter(
      (entry, index, all) =>
        all.findIndex((other) => other.start_date === entry.start_date && other.end_date === entry.end_date) === index
    );
    await supabase.from("absences").insert(
      restored.map(({ household_id, user_id, start_date, end_date, note }) => ({
        household_id,
        user_id,
        start_date,
        end_date,
        note,
      }))
    );
    load();
  };

  if (loading) return <Loading />;

  const selectedInfo = dayInfo(selected);
  // „Heute" nur anbieten, wenn man gerade woanders ist
  const now = new Date();
  const showsToday =
    selected === today && cursor.year === now.getFullYear() && cursor.month === now.getMonth();
  const awayToday = dayInfo(today).absences;
  const isEmptyDay =
    selectedInfo.events.length +
      selectedInfo.absences.length +
      selectedInfo.chores.length +
      selectedInfo.waste.length ===
    0;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 110 }}
        refreshControl={pullToRefresh(refreshing, onRefresh)}
      >
        {awayToday.length > 0 && (
          <View style={styles.awayBanner}>
            <Ionicons name="airplane" size={14} color={dot.absence} />
            <Text style={styles.awayText}>
              Heute nicht da: {awayToday.map((block) => nameFor(block.user_id)).join(", ")}
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
          {!showsToday && (
            <TouchableOpacity onPress={jumpToToday} style={styles.todayButton}>
              <Text style={styles.todayButtonText}>Heute</Text>
            </TouchableOpacity>
          )}
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
                  const pickups = collections.filter(
                    (entry) => entry.date === iso && entry.status !== "cancelled"
                  );
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
                      <View style={styles.markers}>
                        {hasChore && <View style={[styles.choreDot, { backgroundColor: dot.chore }]} />}
                        {pickups.slice(0, MAX_BIN_ICONS).map((entry) => (
                          <Ionicons
                            key={entry.bin.id}
                            name="trash"
                            size={10}
                            color={colors.waste[entry.bin.kind]}
                          />
                        ))}
                      </View>
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
          {bins.map((bin) => (
            <TouchableOpacity key={bin.id} style={styles.legendItem} onPress={() => router.push("/waste")}>
              <Ionicons name="trash" size={11} color={colors.waste[bin.kind]} />
              <Text style={styles.legendText}>{bin.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.legendItem} onPress={() => router.push("/waste")}>
            <Ionicons name={bins.length === 0 ? "add-circle-outline" : "settings-outline"} size={13} color={colors.tint} />
            <Text style={styles.legendLink}>{bins.length === 0 ? "Müllabfuhr eintragen" : "Müllabfuhr"}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.dayPanel}>
          <Text style={styles.dayTitle}>{formatLong(selected)}</Text>

          {isEmptyDay && <Text style={styles.emptyDay}>Nichts eingetragen.</Text>}

          {selectedInfo.waste.map((entry) => (
            <TouchableOpacity
              key={`${entry.bin.id}-${entry.originalDate}`}
              style={styles.entry}
              onPress={() =>
                router.push({ pathname: "/waste-change", params: { bin: entry.bin.id, date: entry.originalDate } })
              }
            >
              <Ionicons
                name={entry.status === "cancelled" ? "trash-outline" : "trash"}
                size={18}
                color={colors.waste[entry.bin.kind]}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.entryTitle, entry.status === "cancelled" && styles.entryCancelled]}>
                  {entry.bin.label} {entry.status === "cancelled" ? "fällt aus" : "wird abgeholt"}
                </Text>
                <Text style={styles.entryMeta}>
                  {entry.status === "moved"
                    ? `verschoben vom ${formatShort(entry.originalDate)}`
                    : rhythmText(entry.bin)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.subtext} />
            </TouchableOpacity>
          ))}

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

          {selectedInfo.absences.map((block) => (
            <View key={block.id} style={styles.entry}>
              <Ionicons name="airplane" size={18} color={dot.absence} />
              <View style={{ flex: 1 }}>
                <Text style={styles.entryTitle}>
                  {block.user_id === session?.user.id ? "Du bist weg" : `${nameFor(block.user_id)} ist weg`}
                </Text>
                <Text style={styles.entryMeta}>
                  {block.start_date === block.end_date
                    ? "ganztägig"
                    : `${formatShort(block.start_date)} – ${formatShort(block.end_date)}`}
                  {block.note ? ` · ${block.note}` : ""}
                </Text>
              </View>
              {block.user_id === session?.user.id && (
                <TouchableOpacity onPress={() => removeAbsence(block)} style={styles.iconButton}>
                  <Ionicons name="trash-outline" size={17} color={colors.subtext} />
                </TouchableOpacity>
              )}
            </View>
          ))}

          {selectedInfo.chores.map((chore) => (
            <TouchableOpacity
              key={chore.id}
              style={styles.entry}
              onPress={() =>
                router.push({ pathname: "/chore/[taskId]", params: { taskId: chore.task_id, date: chore.due_date } })
              }
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
  markers: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2, height: 12, marginTop: 1 },
  choreDot: { width: 5, height: 5, borderRadius: 3 },
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
  dayCircle: { width: 28, height: 28, borderRadius: 14, justifyContent: "center", alignItems: "center" },
  dayToday: { borderWidth: 1.5, borderColor: colors.primary },
  daySelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayNumber: { fontSize: 15, color: colors.text },
  dayOutside: { color: colors.faint },
  dayNumberSelected: { color: "#fff", fontWeight: "700" },
  legend: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", columnGap: 14, rowGap: 6, paddingVertical: 6 },
  legendLink: { fontSize: 12, fontWeight: "600", color: colors.tint },
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
  entryCancelled: { color: colors.subtext },
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
