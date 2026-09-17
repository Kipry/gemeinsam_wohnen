import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { supabase } from "../src/lib/supabase";
import { useRefresh } from "../src/lib/useRefresh";
import { useAuth } from "../src/lib/AuthProvider";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { FORMER_MEMBER, useHouseholdMembers } from "../src/lib/useHouseholdMembers";
import { makeStyles, useColors } from "../src/lib/theme";
import { Card, Empty, Loading, Muted, pullToRefresh, Screen } from "../src/components/ui";
import { confirmChoreRestart, statsCountingSince } from "../src/lib/choreRestart";
import type { ChoreStats } from "../src/types/database";

/** „14.09.2026" */
function formatDay(timestamp: string) {
  const date = new Date(timestamp);
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
}

export default function StatsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { session } = useAuth();
  const { activeHousehold, refresh } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);
  const [stats, setStats] = useState<ChoreStats[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeHousehold) return;
    const { data, error } = await supabase
      .from("chore_stats_view")
      .select("*")
      .eq("household_id", activeHousehold.id);

    if (error) console.error(error);
    setStats((data as ChoreStats[]) ?? []);
    setLoading(false);
  }, [activeHousehold]);
  const { refreshing, onRefresh } = useRefresh(load);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) return <Loading />;

  const rows = [...stats].sort((a, b) => b.points_done - a.points_done);
  const maxPoints = Math.max(1, ...rows.map((r) => r.points_done));
  const avgPoints = rows.length
    ? rows.reduce((sum, r) => sum + r.points_done, 0) / rows.length
    : 0;

  return (
    <Screen>
      <FlatList
        refreshControl={pullToRefresh(refreshing, onRefresh)}
        data={rows}
        keyExtractor={(item) => item.user_id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        ListHeaderComponent={
          <Muted>
            Punkte zählen erledigte Putzplan-Aufgaben
            {activeHousehold ? ` seit ${formatDay(statsCountingSince(activeHousehold))}` : ""}. „Pünktlich"
            heißt: bis zum Fälligkeitstag abgehakt.
          </Muted>
        }
        ListFooterComponent={
          activeHousehold ? (
            <View style={styles.restart}>
              <TouchableOpacity
                onPress={() =>
                  confirmChoreRestart(activeHousehold.id, async () => {
                    await refresh();
                    load();
                  })
                }
                accessibilityRole="button"
              >
                <Text style={styles.restartLink}>Putzplan neu starten</Text>
              </TouchableOpacity>
              <Muted>Alle fangen bei null an – zum Beispiel, wenn neue Mitbewohner eingezogen sind.</Muted>
            </View>
          ) : null
        }
        ListEmptyComponent={<Empty>Noch keine Daten.</Empty>}
        renderItem={({ item }) => {
          const name =
            item.user_id === session?.user.id
              ? "Du"
              : members.find((m) => m.id === item.user_id)?.full_name ?? FORMER_MEMBER;
          const diff = item.points_done - avgPoints;
          const onTimeRate =
            item.tasks_done > 0 ? Math.round((item.done_on_time / item.tasks_done) * 100) : null;

          return (
            <Card>
              <View style={styles.header}>
                <Text style={styles.name}>{name}</Text>
                <Text style={styles.points}>
                  {item.points_done} Pkt · {item.tasks_done} erledigt
                </Text>
              </View>

              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    { width: `${Math.max(3, (item.points_done / maxPoints) * 100)}%` },
                  ]}
                />
              </View>

              <View style={styles.statsRow}>
                <Text style={[styles.diff, { color: diff >= 0 ? colors.successText : colors.dangerText }]}>
                  {diff >= 0 ? "+" : ""}
                  {diff.toFixed(1)} ggü. Schnitt
                </Text>
                {onTimeRate !== null && <Text style={styles.stat}>{onTimeRate}% pünktlich</Text>}
              </View>

              <View style={styles.statsRow}>
                <Text style={styles.stat}>{item.open_assigned} offen zugeteilt</Text>
                {item.overdue_assigned > 0 && (
                  <Text style={[styles.stat, { color: colors.dangerText, fontWeight: "700" }]}>
                    {item.overdue_assigned} überfällig
                  </Text>
                )}
              </View>
            </Card>
          );
        }}
      />
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  name: { fontSize: 16, fontWeight: "700", color: colors.text },
  points: { fontSize: 13, color: colors.subtext },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
  statsRow: { flexDirection: "row", justifyContent: "space-between" },
  diff: { fontSize: 12, fontWeight: "600" },
  stat: { fontSize: 12, color: colors.subtext },
  restart: { alignItems: "center", gap: 4, marginTop: 12 },
  restartLink: { fontSize: 15, fontWeight: "600", color: colors.tint },
}));
