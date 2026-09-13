import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { supabase } from "../../src/lib/supabase";
import { useHousehold } from "../../src/lib/HouseholdProvider";
import { useHouseholdMembers } from "../../src/lib/useHouseholdMembers";
import { colors } from "../../src/lib/theme";
import type { BalanceRow } from "../../src/types/database";

export default function BalanceScreen() {
  const { activeHousehold } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);
  const [rows, setRows] = useState<BalanceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeHousehold) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("balance_view")
      .select("*")
      .eq("household_id", activeHousehold.id);

    if (error) console.error(error);
    setLoading(false);

    const byUser = new Map((data ?? []).map((row) => [row.user_id, row as BalanceRow]));
    const merged: BalanceRow[] = members.map((member) => ({
      household_id: activeHousehold.id,
      user_id: member.id,
      full_name: member.full_name,
      tasks_done: byUser.get(member.id)?.tasks_done ?? 0,
      points_done: byUser.get(member.id)?.points_done ?? 0,
    }));
    merged.sort((a, b) => b.points_done - a.points_done);
    setRows(merged);
  }, [activeHousehold, members]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const maxPoints = Math.max(1, ...rows.map((r) => r.points_done));
  const avgPoints = rows.length ? rows.reduce((sum, r) => sum + r.points_done, 0) / rows.length : 0;

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Wer hat wie viel erledigt?</Text>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.user_id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        ListEmptyComponent={<Text style={styles.empty}>Noch keine erledigten Aufgaben.</Text>}
        renderItem={({ item }) => {
          const barWidth = `${Math.max(4, (item.points_done / maxPoints) * 100)}%` as const;
          const diff = item.points_done - avgPoints;
          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.name}>{item.full_name}</Text>
                <Text style={styles.points}>
                  {item.points_done} Pkt · {item.tasks_done} Aufgaben
                </Text>
              </View>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: barWidth }]} />
              </View>
              <Text style={[styles.diff, diff >= 0 ? { color: colors.success } : { color: colors.danger }]}>
                {diff >= 0 ? "+" : ""}
                {diff.toFixed(1)} ggü. Durchschnitt
              </Text>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  heading: { fontSize: 16, fontWeight: "600", color: colors.text, padding: 16, paddingBottom: 0 },
  empty: { textAlign: "center", color: colors.subtext, marginTop: 20 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderColor: colors.border,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between" },
  name: { fontSize: 15, fontWeight: "600", color: colors.text },
  points: { fontSize: 13, color: colors.subtext },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
  diff: { fontSize: 12, fontWeight: "600" },
});
