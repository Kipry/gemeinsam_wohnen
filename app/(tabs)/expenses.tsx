import { useCallback, useEffect, useMemo, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/lib/AuthProvider";
import { useHousehold } from "../../src/lib/HouseholdProvider";
import { useHouseholdMembers } from "../../src/lib/useHouseholdMembers";
import { colors } from "../../src/lib/theme";
import { formatCents, suggestSettlements } from "../../src/lib/money";
import { Button, Card, Empty, Loading, Screen, SectionTitle } from "../../src/components/ui";
import type { Expense, ExpenseBalance } from "../../src/types/database";

type ExpenseWithShares = Expense & { expense_shares: { user_id: string; share_cents: number }[] };

export default function ExpensesScreen() {
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);
  const [expenses, setExpenses] = useState<ExpenseWithShares[]>([]);
  const [balances, setBalances] = useState<ExpenseBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [settling, setSettling] = useState<string | null>(null);
  const [booked, setBooked] = useState(0);

  const load = useCallback(async () => {
    if (!activeHousehold) return;

    const [expenseResult, balanceResult] = await Promise.all([
      supabase
        .from("expenses")
        .select("*, expense_shares(user_id, share_cents)")
        .eq("household_id", activeHousehold.id)
        .is("deleted_at", null)
        .order("expense_date", { ascending: false })
        .limit(100),
      supabase.from("expense_balance_view").select("*").eq("household_id", activeHousehold.id),
    ]);

    if (expenseResult.error) console.error(expenseResult.error);
    if (balanceResult.error) console.error(balanceResult.error);

    setExpenses((expenseResult.data as ExpenseWithShares[]) ?? []);
    setBalances((balanceResult.data as ExpenseBalance[]) ?? []);
    setLoading(false);
  }, [activeHousehold]);

  // Fällige feste Kosten nachbuchen, bevor der Saldo angezeigt wird
  useEffect(() => {
    if (!activeHousehold) return;
    supabase
      .rpc("book_due_recurring", { p_household_id: activeHousehold.id })
      .then(({ data, error }) => {
        if (error) {
          console.error(error);
          return;
        }
        if (typeof data === "number" && data > 0) {
          setBooked(data);
        }
        load();
      });
  }, [activeHousehold, load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const nameFor = (userId: string) =>
    userId === session?.user.id ? "Du" : members.find((m) => m.id === userId)?.full_name ?? "?";

  const myBalance = balances.find((b) => b.user_id === session?.user.id)?.net_cents ?? 0;

  const myTransfers = useMemo(
    () =>
      suggestSettlements(balances).filter(
        (t) => t.from === session?.user.id || t.to === session?.user.id
      ),
    [balances, session]
  );

  const settle = async (transfer: { from: string; to: string; amount_cents: number }) => {
    if (!activeHousehold || !session) return;
    const key = `${transfer.from}-${transfer.to}`;
    setSettling(key);

    const { error } = await supabase.from("settlements").insert({
      household_id: activeHousehold.id,
      from_user: transfer.from,
      to_user: transfer.to,
      amount_cents: transfer.amount_cents,
      created_by: session.user.id,
    });

    setSettling(null);
    if (error) {
      Alert.alert("Fehler", error.message);
      return;
    }
    load();
  };

  if (loading) return <Loading />;

  return (
    <Screen>
      <FlatList
        data={expenses}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 90 }}
        ListHeaderComponent={
          <View style={{ gap: 10, marginBottom: 6 }}>
            {booked > 0 && (
              <TouchableOpacity onPress={() => router.push("/recurring")}>
                <Card style={styles.bookedCard}>
                  <Ionicons name="repeat" size={18} color={colors.primary} />
                  <Text style={styles.bookedText}>
                    {booked === 1 ? "1 feste Kosten-Buchung" : `${booked} feste Kosten-Buchungen`}{" "}
                    ergänzt
                  </Text>
                </Card>
              </TouchableOpacity>
            )}

            <Card>
              <Text style={styles.balanceLabel}>Dein Saldo</Text>
              <Text
                style={[
                  styles.balanceValue,
                  { color: myBalance >= 0 ? colors.success : colors.danger },
                ]}
              >
                {myBalance >= 0 ? "+" : ""}
                {formatCents(myBalance)}
              </Text>
              <Text style={styles.balanceHint}>
                {myBalance > 0
                  ? "Du bekommst Geld zurück."
                  : myBalance < 0
                    ? "Du schuldest der WG Geld."
                    : "Alles ausgeglichen."}
              </Text>
            </Card>

            {myTransfers.length > 0 && (
              <>
                <SectionTitle>Ausgleich</SectionTitle>
                {myTransfers.map((t) => {
                  const iPay = t.from === session?.user.id;
                  const key = `${t.from}-${t.to}`;
                  return (
                    <Card key={key} style={styles.settleCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.settleText}>
                          {iPay
                            ? `Du zahlst ${nameFor(t.to)}`
                            : `${nameFor(t.from)} zahlt dir`}
                        </Text>
                        <Text style={styles.settleAmount}>{formatCents(t.amount_cents)}</Text>
                      </View>
                      <Button
                        title="Bezahlt"
                        variant="secondary"
                        loading={settling === key}
                        onPress={() => settle(t)}
                      />
                    </Card>
                  );
                })}
              </>
            )}

            <SectionTitle>Ausgaben</SectionTitle>
          </View>
        }
        ListEmptyComponent={<Empty>Noch keine Ausgaben erfasst.</Empty>}
        renderItem={({ item }) => {
          const myShare =
            item.expense_shares.find((s) => s.user_id === session?.user.id)?.share_cents ?? 0;
          return (
            <TouchableOpacity onPress={() => router.push(`/expense/${item.id}`)}>
              <Card style={styles.expenseCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.expenseTitle}>{item.title}</Text>
                  <Text style={styles.expenseMeta}>
                    {nameFor(item.paid_by)} · {item.expense_date} · dein Anteil{" "}
                    {formatCents(myShare)}
                  </Text>
                </View>
                <Text style={styles.expenseAmount}>{formatCents(item.amount_cents)}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.subtext} />
              </Card>
            </TouchableOpacity>
          );
        }}
      />

      <TouchableOpacity style={styles.fab} onPress={() => router.push("/new-expense")}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bookedCard: { flexDirection: "row", alignItems: "center", gap: 8 },
  bookedText: { flex: 1, fontSize: 13, color: colors.text },
  balanceLabel: { fontSize: 13, color: colors.subtext },
  balanceValue: { fontSize: 30, fontWeight: "700" },
  balanceHint: { fontSize: 13, color: colors.subtext },
  settleCard: { flexDirection: "row", alignItems: "center", gap: 10 },
  settleText: { fontSize: 14, color: colors.subtext },
  settleAmount: { fontSize: 17, fontWeight: "700", color: colors.text },
  expenseCard: { flexDirection: "row", alignItems: "center", gap: 10 },
  expenseTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  expenseMeta: { fontSize: 12, color: colors.subtext, marginTop: 2 },
  expenseAmount: { fontSize: 16, fontWeight: "700", color: colors.text },
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
