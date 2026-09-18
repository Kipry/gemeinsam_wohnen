import { useCallback, useEffect, useMemo, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../src/lib/supabase";
import { useRefresh } from "../../src/lib/useRefresh";
import { hapticSuccess } from "../../src/lib/haptics";
import { useAuth } from "../../src/lib/AuthProvider";
import { useHousehold } from "../../src/lib/HouseholdProvider";
import { FORMER_MEMBER, useHouseholdMembers } from "../../src/lib/useHouseholdMembers";
import { makeStyles, useColors } from "../../src/lib/theme";
import { formatCents, suggestSettlements } from "../../src/lib/money";
import { Button, Card, Empty, Loading, pullToRefresh, Screen, SectionTitle } from "../../src/components/ui";
import { onReconnect } from "../../src/lib/connectivity";
import { useOfflineSnapshot } from "../../src/lib/offlineCache";
import type { Expense, ExpenseBalance } from "../../src/types/database";

type ExpenseWithShares = Expense & { expense_shares: { user_id: string; share_cents: number }[] };

type ExpensesSnapshot = { expenses: ExpenseWithShares[]; balances: ExpenseBalance[] };

/** „14.09." — Jahr nur, wenn es nicht das laufende ist; der Wochentag machte die Zeile zu lang */
function formatExpenseDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${Number(year) === new Date().getFullYear() ? "" : year}`;
}

export default function ExpensesScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);
  const [expenses, setExpenses] = useState<ExpenseWithShares[]>([]);
  const [balances, setBalances] = useState<ExpenseBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [settling, setSettling] = useState<string | null>(null);
  const [booked, setBooked] = useState(0);

  // Ohne Netz den letzten Stand zeigen statt „alles ausgeglichen"
  const saveSnapshot = useOfflineSnapshot<ExpensesSnapshot>(
    activeHousehold ? `expenses:${activeHousehold.id}` : null,
    (snapshot) => {
      setExpenses(snapshot.expenses);
      setBalances(snapshot.balances);
      setLoading(false);
    }
  );

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

    if (expenseResult.error || balanceResult.error) {
      console.error(expenseResult.error ?? balanceResult.error);
      setLoading(false);
      return;
    }

    const snapshot = {
      expenses: (expenseResult.data as ExpenseWithShares[]) ?? [],
      balances: (balanceResult.data as ExpenseBalance[]) ?? [],
    };
    setExpenses(snapshot.expenses);
    setBalances(snapshot.balances);
    saveSnapshot(snapshot);
    setLoading(false);
  }, [activeHousehold, saveSnapshot]);

  useEffect(() => onReconnect(() => void load()), [load]);
  const { refreshing, onRefresh } = useRefresh(load);

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
    userId === session?.user.id ? "Du" : members.find((m) => m.id === userId)?.full_name ?? FORMER_MEMBER;

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
    hapticSuccess();
    load();
  };

  if (loading) return <Loading />;

  return (
    <Screen>
      <FlatList
        refreshControl={pullToRefresh(refreshing, onRefresh)}
        data={expenses}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 90 }}
        ListHeaderComponent={
          <View style={{ gap: 10, marginBottom: 6 }}>
            {booked > 0 && (
              <TouchableOpacity onPress={() => router.push("/recurring")}>
                <Card style={styles.bookedCard}>
                  <Ionicons name="repeat" size={18} color={colors.tint} />
                  <Text style={styles.bookedText}>
                    {booked === 1 ? "1 feste Kosten-Buchung" : `${booked} feste Kosten-Buchungen`}{" "}
                    ergänzt
                  </Text>
                </Card>
              </TouchableOpacity>
            )}

            {/* Wer wem was zahlt, steht darunter beim Ausgleich — hier nur die Zahl */}
            <Card>
              <Text style={styles.balanceLabel}>Dein Saldo</Text>
              {myBalance === 0 ? (
                <Text style={styles.balanceEven}>Alles ausgeglichen</Text>
              ) : (
                <Text
                  style={[
                    styles.balanceValue,
                    { color: myBalance > 0 ? colors.successText : colors.dangerText },
                  ]}
                >
                  {myBalance > 0 ? "+" : ""}
                  {formatCents(myBalance)}
                </Text>
              )}
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
                    {nameFor(item.paid_by)} · {formatExpenseDate(item.expense_date)}
                    {myShare > 0 ? ` · dein Anteil ${formatCents(myShare)}` : ""}
                  </Text>
                </View>
                {item.receipt_path && (
                  <Ionicons name="receipt-outline" size={16} color={colors.subtext} />
                )}
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

const useStyles = makeStyles((colors) => ({
  bookedCard: { flexDirection: "row", alignItems: "center", gap: 8 },
  bookedText: { flex: 1, fontSize: 13, color: colors.text },
  balanceLabel: { fontSize: 13, color: colors.subtext },
  balanceValue: { fontSize: 30, fontWeight: "700" },
  balanceEven: { fontSize: 22, fontWeight: "700", color: colors.text },
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
}));
