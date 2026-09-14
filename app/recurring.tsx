import { useCallback, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { Alert, FlatList, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../src/lib/supabase";
import { useAuth } from "../src/lib/AuthProvider";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { FORMER_MEMBER, useHouseholdMembers } from "../src/lib/useHouseholdMembers";
import { makeStyles, useColors } from "../src/lib/theme";
import { formatCents } from "../src/lib/money";
import { Button, Card, Empty, Loading, Muted, Screen } from "../src/components/ui";
import type { RecurringExpense } from "../src/types/database";

export default function RecurringScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);
  const [entries, setEntries] = useState<RecurringExpense[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeHousehold) return;
    const { data, error } = await supabase
      .from("recurring_expenses")
      .select("*")
      .eq("household_id", activeHousehold.id)
      .order("day_of_month");

    if (error) console.error(error);
    setEntries((data as RecurringExpense[]) ?? []);
    setLoading(false);
  }, [activeHousehold]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const nameFor = (userId: string) =>
    userId === session?.user.id ? "Du" : members.find((m) => m.id === userId)?.full_name ?? FORMER_MEMBER;

  const toggleActive = async (entry: RecurringExpense) => {
    setEntries((prev) =>
      prev.map((row) => (row.id === entry.id ? { ...row, active: !row.active } : row))
    );
    await supabase
      .from("recurring_expenses")
      .update({ active: !entry.active })
      .eq("id", entry.id);
  };

  const remove = (entry: RecurringExpense) => {
    Alert.alert(
      "Feste Kosten löschen",
      `„${entry.title}" wird künftig nicht mehr gebucht. Bereits gebuchte Ausgaben bleiben erhalten.`,
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Löschen",
          style: "destructive",
          onPress: async () => {
            await supabase.from("recurring_expenses").delete().eq("id", entry.id);
            load();
          },
        },
      ]
    );
  };

  if (loading) return <Loading />;

  return (
    <Screen>
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        ListHeaderComponent={
          <Muted>
            Miete, Strom, Internet, Streaming — einmal anlegen, danach bucht die App die
            Ausgabe jeden Monat selbst.
          </Muted>
        }
        ListEmptyComponent={<Empty>Noch keine festen Kosten angelegt.</Empty>}
        renderItem={({ item }) => (
          <Card>
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, !item.active && styles.inactive]}>{item.title}</Text>
                <Text style={styles.meta}>
                  {formatCents(item.amount_cents)} · jeden {item.day_of_month}. ·{" "}
                  {item.paid_by === session?.user.id
                    ? "du zahlst"
                    : `${nameFor(item.paid_by)} zahlt`}
                </Text>
                {item.last_booked_on && (
                  <Text style={styles.meta}>Zuletzt gebucht: {item.last_booked_on}</Text>
                )}
              </View>
              <Switch value={item.active} onValueChange={() => toggleActive(item)} />
            </View>
            <TouchableOpacity onPress={() => remove(item)} style={styles.deleteRow}>
              <Ionicons name="trash-outline" size={15} color={colors.dangerText} />
              <Text style={styles.deleteText}>Löschen</Text>
            </TouchableOpacity>
          </Card>
        )}
      />

      <View style={styles.footer}>
        <Button title="Feste Kosten hinzufügen" onPress={() => router.push("/new-recurring")} />
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontSize: 16, fontWeight: "600", color: colors.text },
  inactive: { color: colors.subtext, textDecorationLine: "line-through" },
  meta: { fontSize: 13, color: colors.subtext, marginTop: 2 },
  deleteRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  deleteText: { fontSize: 13, color: colors.dangerText, fontWeight: "600" },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card },
}));
