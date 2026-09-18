import { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../src/lib/supabase";
import { useRefresh } from "../src/lib/useRefresh";
import { useAuth } from "../src/lib/AuthProvider";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { FORMER_MEMBER, useHouseholdMembers } from "../src/lib/useHouseholdMembers";
import { makeStyles, useColors } from "../src/lib/theme";
import { formatCents } from "../src/lib/money";
import { formatMonth, monthName, monthRange } from "../src/lib/dates";
import {
  percentChange,
  summarizeChores,
  summarizeExpenses,
  type ReviewChore,
  type ReviewExpense,
} from "../src/lib/monthReview";
import { Card, Muted, pullToRefresh } from "../src/components/ui";
import { confirmChoreRestart, statsCountingSince } from "../src/lib/choreRestart";
import type { ChoreStats } from "../src/types/database";

/** „14.09.2026" */
function formatDay(timestamp: string) {
  const date = new Date(timestamp);
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
}

/**
 * Rückblick: oben der Punktestand seit dem letzten Neustart (früher eigene
 * Statistik-Seite), darunter Kosten und Putzen des gewählten Monats.
 */
export default function MonthReview() {
  const styles = useStyles();
  const colors = useColors();
  const { session } = useAuth();
  const { activeHousehold, refresh } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);

  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [expenses, setExpenses] = useState<ReviewExpense[]>([]);
  const [previousTotal, setPreviousTotal] = useState(0);
  const [chores, setChores] = useState<ReviewChore[]>([]);
  const [stats, setStats] = useState<ChoreStats[]>([]);
  const [loading, setLoading] = useState(true);

  const isCurrentMonth = cursor.year === now.getFullYear() && cursor.month === now.getMonth();

  const load = useCallback(async () => {
    if (!activeHousehold) return;
    setLoading(true);

    const range = monthRange(cursor.year, cursor.month);
    const previousMonth = new Date(cursor.year, cursor.month - 1, 1);
    const previousRange = monthRange(previousMonth.getFullYear(), previousMonth.getMonth());

    // Erledigt-Zeitpunkte sind Zeitstempel: Monatsgrenzen in lokaler Zeit bilden
    const monthStart = new Date(cursor.year, cursor.month, 1).toISOString();
    const nextMonthStart = new Date(cursor.year, cursor.month + 1, 1).toISOString();

    const [expenseResult, previousResult, choreResult] = await Promise.all([
      supabase
        .from("expenses")
        .select("amount_cents, category, paid_by, expense_shares(user_id, share_cents)")
        .eq("household_id", activeHousehold.id)
        .is("deleted_at", null)
        .gte("expense_date", range.start)
        .lte("expense_date", range.end),
      supabase
        .from("expenses")
        .select("amount_cents")
        .eq("household_id", activeHousehold.id)
        .is("deleted_at", null)
        .gte("expense_date", previousRange.start)
        .lte("expense_date", previousRange.end),
      supabase
        .from("task_occurrences")
        .select("completed_by, due_date, completed_at, tasks(points)")
        .eq("household_id", activeHousehold.id)
        .eq("status", "done")
        .gte("completed_at", monthStart)
        .lt("completed_at", nextMonthStart),
    ]);

    setExpenses((expenseResult.data as ReviewExpense[]) ?? []);
    setPreviousTotal(
      ((previousResult.data as { amount_cents: number }[]) ?? []).reduce(
        (sum, row) => sum + row.amount_cents,
        0
      )
    );
    setChores((choreResult.data as unknown as ReviewChore[]) ?? []);
    setLoading(false);
  }, [activeHousehold, cursor]);

  // Punktestand seit dem letzten Neustart — unabhängig vom gewählten Monat
  const loadStats = useCallback(async () => {
    if (!activeHousehold) return;
    const { data, error } = await supabase
      .from("chore_stats_view")
      .select("*")
      .eq("household_id", activeHousehold.id);
    if (error) {
      console.error(error);
      return;
    }
    setStats((data as ChoreStats[]) ?? []);
  }, [activeHousehold]);

  const loadAll = useCallback(async () => {
    await Promise.all([load(), loadStats()]);
  }, [load, loadStats]);
  const { refreshing, onRefresh } = useRefresh(loadAll);

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [loadAll])
  );

  const memberIds = useMemo(() => members.map((member) => member.id), [members]);
  const expenseSummary = useMemo(() => summarizeExpenses(expenses, memberIds), [expenses, memberIds]);
  const choreSummary = useMemo(() => summarizeChores(chores, memberIds), [chores, memberIds]);

  const nameFor = (userId: string) =>
    userId === session?.user.id ? "Du" : members.find((m) => m.id === userId)?.full_name ?? FORMER_MEMBER;

  const shiftMonth = (delta: number) => {
    setCursor((prev) => {
      const date = new Date(prev.year, prev.month + delta, 1);
      return { year: date.getFullYear(), month: date.getMonth() };
    });
  };

  const change = percentChange(expenseSummary.totalCents, previousTotal);
  const myShare = session ? expenseSummary.byPerson[session.user.id]?.shareCents ?? 0 : 0;
  const previousMonthName = monthName(cursor.month - 1);

  const people = Object.entries(expenseSummary.byPerson)
    .filter(([, entry]) => entry.paidCents > 0 || entry.shareCents > 0)
    .sort((a, b) => b[1].paidCents - a[1].paidCents);

  const chorePeople = Object.entries(choreSummary.byPerson).sort((a, b) => b[1].points - a[1].points);
  const maxCategory = Math.max(1, ...expenseSummary.byCategory.map((entry) => entry.cents));
  const maxPoints = Math.max(1, ...chorePeople.map(([, entry]) => entry.points));

  const fairRows = [...stats].sort((a, b) => b.points_done - a.points_done);
  const fairMax = Math.max(1, ...fairRows.map((row) => row.points_done));
  const fairAverage = fairRows.length
    ? fairRows.reduce((sum, row) => sum + row.points_done, 0) / fairRows.length
    : 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={pullToRefresh(refreshing, onRefresh)}
    >
      {activeHousehold && fairRows.length > 0 && (
        <Card>
          <Text style={styles.cardTitle}>Putzen seit {formatDay(statsCountingSince(activeHousehold))}</Text>
          {fairRows.map((row) => {
            const diff = row.points_done - fairAverage;
            const onTime = row.tasks_done > 0 ? Math.round((row.done_on_time / row.tasks_done) * 100) : null;
            return (
              <View key={row.user_id} style={styles.fairRow}>
                <BarRow
                  label={nameFor(row.user_id)}
                  value={`${row.points_done} Pkt · ${row.tasks_done} erledigt`}
                  ratio={row.points_done / fairMax}
                />
                <Text style={styles.fairMeta}>
                  <Text style={{ color: diff >= 0 ? colors.successText : colors.dangerText, fontWeight: "600" }}>
                    {diff >= 0 ? "+" : "−"}
                    {Math.abs(diff).toFixed(1).replace(".", ",")} ggü. Schnitt
                  </Text>
                  {onTime !== null ? ` · ${onTime} % pünktlich` : ""}
                  {row.open_assigned > 0 ? ` · ${row.open_assigned} offen` : ""}
                  {row.overdue_assigned > 0 && (
                    <Text style={{ color: colors.dangerText, fontWeight: "700" }}>
                      {` · ${row.overdue_assigned} überfällig`}
                    </Text>
                  )}
                </Text>
              </View>
            );
          })}
          <TouchableOpacity
            style={styles.restart}
            onPress={() =>
              confirmChoreRestart(activeHousehold.id, async () => {
                await refresh();
                loadStats();
              })
            }
            accessibilityRole="button"
          >
            <Text style={styles.restartLink}>Putzplan neu starten</Text>
          </TouchableOpacity>
        </Card>
      )}

      <View style={styles.monthHeader}>
        <TouchableOpacity onPress={() => shiftMonth(-1)} style={styles.monthButton}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.monthTitle}>{formatMonth(cursor.year, cursor.month)}</Text>
        <TouchableOpacity
          onPress={() => shiftMonth(1)}
          style={styles.monthButton}
          disabled={isCurrentMonth}
        >
          <Ionicons
            name="chevron-forward"
            size={20}
            color={isCurrentMonth ? colors.border : colors.text}
          />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : (
        <>
          <Card>
            <Text style={styles.statLabel}>Ausgegeben</Text>
            <Text style={styles.statValue}>{formatCents(expenseSummary.totalCents)}</Text>
            <Text style={styles.statMeta}>
              {change === null
                ? `Im ${previousMonthName} gab es nichts zu vergleichen`
                : `${change > 0 ? "↑" : change < 0 ? "↓" : "→"} ${Math.abs(change)} % ggü. ${previousMonthName}`}
            </Text>
            {expenseSummary.totalCents > 0 && (
              <Text style={styles.statMeta}>Dein Anteil: {formatCents(myShare)}</Text>
            )}
          </Card>

          <Card>
            <Text style={styles.cardTitle}>Wofür</Text>
            {expenseSummary.byCategory.length === 0 ? (
              <Muted>Keine Ausgaben in diesem Monat.</Muted>
            ) : expenseSummary.byCategory.length === 1 ? (
              // Ein einzelner Balken sagt nichts — dann lieber als Satz
              <Text style={styles.singleLine}>
                Alles unter {expenseSummary.byCategory[0].category}
              </Text>
            ) : (
              expenseSummary.byCategory.map((entry) => (
                <BarRow
                  key={entry.category}
                  label={entry.category}
                  value={formatCents(entry.cents)}
                  ratio={entry.cents / maxCategory}
                />
              ))
            )}
          </Card>

          {people.length > 0 && (
            <Card>
              <Text style={styles.cardTitle}>Wer hat was getragen</Text>
              {people.map(([userId, entry]) => (
                <View key={userId} style={styles.personRow}>
                  <Text style={styles.personName}>{nameFor(userId)}</Text>
                  <View style={styles.personNumbers}>
                    <Text style={styles.personValue}>{formatCents(entry.paidCents)}</Text>
                    <Text style={styles.personMeta}>bezahlt</Text>
                  </View>
                  <View style={styles.personNumbers}>
                    <Text style={styles.personValue}>{formatCents(entry.shareCents)}</Text>
                    <Text style={styles.personMeta}>Anteil</Text>
                  </View>
                </View>
              ))}
            </Card>
          )}

          <Card>
            <Text style={styles.cardTitle}>Putzen im {monthName(cursor.month)}</Text>
            {choreSummary.count === 0 ? (
              <Muted>In diesem Monat wurde noch nichts abgehakt.</Muted>
            ) : (
              <>
                <Muted>
                  {choreSummary.count} {choreSummary.count === 1 ? "Aufgabe" : "Aufgaben"} erledigt ·{" "}
                  {choreSummary.points} Punkte
                </Muted>
                {chorePeople.map(([userId, entry]) => (
                  <BarRow
                    key={userId}
                    label={nameFor(userId)}
                    value={
                      entry.count > 0
                        ? `${entry.points} Pkt · ${Math.round((entry.onTime / entry.count) * 100)} % pünktlich`
                        : "0 Pkt"
                    }
                    ratio={entry.points / maxPoints}
                  />
                ))}
              </>
            )}
          </Card>
        </>
      )}
    </ScrollView>
  );
}

/** Beschriftung und Wert als Text über dem Balken — der Wert hängt nie an der Farbe allein. */
function BarRow({ label, value, ratio }: { label: string; value: string; ratio: number }) {
  const styles = useStyles();
  return (
    <View style={styles.barRow}>
      <View style={styles.barText}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={styles.barValue}>{value}</Text>
      </View>
      <View
        style={[
          styles.bar,
          // Nullwerte bekommen keinen Stummel, der wie ein kleiner Wert aussieht
          { width: ratio > 0 ? `${Math.max(2, ratio * 100)}%` : 0 },
        ]}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  monthHeader: { flexDirection: "row", alignItems: "center", gap: 4 },
  monthButton: { padding: 8 },
  monthTitle: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "700", color: colors.text },
  statLabel: { fontSize: 13, color: colors.subtext },
  statValue: { fontSize: 36, fontWeight: "600", color: colors.text },
  statMeta: { fontSize: 13, color: colors.subtext },
  cardTitle: { fontSize: 13, fontWeight: "700", color: colors.subtext, textTransform: "uppercase" },
  singleLine: { fontSize: 15, color: colors.text },
  barRow: { gap: 4, marginTop: 4 },
  barText: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  barLabel: { fontSize: 14, color: colors.text },
  barValue: { fontSize: 14, color: colors.subtext, fontVariant: ["tabular-nums"] },
  bar: {
    height: 10,
    // Eine Farbe pro Diagramm: die Balken zeigen Größe, nicht Zugehörigkeit.
    backgroundColor: colors.primary,
    // abgerundetes Datenende, gerade an der Grundlinie
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  personRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    gap: 12,
  },
  personName: { flex: 1, fontSize: 15, color: colors.text },
  personNumbers: { alignItems: "flex-end", minWidth: 84 },
  personValue: { fontSize: 15, color: colors.text, fontVariant: ["tabular-nums"] },
  personMeta: { fontSize: 11, color: colors.subtext },
  fairRow: { gap: 2 },
  fairMeta: { fontSize: 12, color: colors.subtext },
  restart: { alignSelf: "center", paddingTop: 8, paddingBottom: 2 },
  restartLink: { fontSize: 14, fontWeight: "600", color: colors.tint },
}));
