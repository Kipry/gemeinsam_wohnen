import { useCallback, useState } from "react";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/lib/AuthProvider";
import { useHousehold } from "../../src/lib/HouseholdProvider";
import { FORMER_MEMBER, useHouseholdMembers } from "../../src/lib/useHouseholdMembers";
import { makeStyles } from "../../src/lib/theme";
import { centsToInput, formatCents } from "../../src/lib/money";
import {
  ExpenseForm,
  type ExpenseFormInitial,
  type ExpenseFormValues,
  type SplitMode,
} from "../../src/components/ExpenseForm";
import { Button, Card, ErrorText, Loading } from "../../src/components/ui";
import { ReceiptSection } from "../../src/components/ReceiptSection";
import type { Expense } from "../../src/types/database";

type LoadedExpense = Expense & {
  expense_shares: { user_id: string; share_cents: number; weight: number | null }[];
};

export default function ExpenseDetail() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);
  const [expense, setExpense] = useState<LoadedExpense | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const { data, error: loadError } = await supabase
      .from("expenses")
      .select("*, expense_shares(user_id, share_cents, weight)")
      .eq("id", id)
      .single();

    if (loadError) {
      setError(loadError.message);
      return;
    }
    setExpense(data as LoadedExpense);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!expense || !session) return <Loading />;

  const nameFor = (userId: string) =>
    userId === session.user.id ? "Du" : members.find((m) => m.id === userId)?.full_name ?? FORMER_MEMBER;

  const save = async (values: ExpenseFormValues) => {
    setSaving(true);
    const { error: rpcError } = await supabase.rpc("update_expense", {
      p_expense_id: expense.id,
      p_title: values.title,
      p_amount_cents: values.amount_cents,
      p_paid_by: values.paid_by,
      p_shares: values.shares,
      p_split_mode: values.split_mode,
      p_category: values.category,
      p_expense_date: expense.expense_date,
      p_note: values.note,
    });
    setSaving(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setEditing(false);
    load();
  };

  const remove = () => {
    Alert.alert("Ausgabe löschen", `„${expense.title}" aus der Abrechnung nehmen?`, [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Löschen",
        style: "destructive",
        onPress: async () => {
          const { error: rpcError } = await supabase.rpc("delete_expense", {
            p_expense_id: expense.id,
          });
          if (rpcError) {
            setError(rpcError.message);
            return;
          }
          if (router.canGoBack()) router.back();
          else router.replace("/(tabs)/expenses");
        },
      },
    ]);
  };

  if (editing) {
    const initial: ExpenseFormInitial = {
      title: expense.title,
      amountExpression: centsToInput(expense.amount_cents),
      paid_by: expense.paid_by,
      split_mode: expense.split_mode as SplitMode,
      category: expense.category,
      note: expense.note,
      participants: expense.expense_shares.map((share) => share.user_id),
      amounts: Object.fromEntries(
        expense.expense_shares.map((share) => [share.user_id, centsToInput(share.share_cents)])
      ),
      weights: Object.fromEntries(
        expense.expense_shares.map((share) => [share.user_id, Number(share.weight ?? 1)])
      ),
    };

    return (
      <>
        {error && <ErrorText>{error}</ErrorText>}
        <ExpenseForm
          members={members}
          currentUserId={session.user.id}
          initial={initial}
          submitLabel="Änderungen speichern"
          saving={saving}
          onSubmit={save}
        />
      </>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.amount}>{formatCents(expense.amount_cents)}</Text>
        <Text style={styles.title}>{expense.title}</Text>
        <Text style={styles.meta}>
          {nameFor(expense.paid_by)} hat bezahlt · {expense.expense_date}
          {expense.category ? ` · ${expense.category}` : ""}
        </Text>
        {expense.note ? <Text style={styles.note}>{expense.note}</Text> : null}
        {expense.updated_at ? (
          <Text style={styles.edited}>Bearbeitet am {expense.updated_at.slice(0, 10)}</Text>
        ) : null}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Anteile</Text>
        {expense.expense_shares
          .slice()
          .sort((a, b) => b.share_cents - a.share_cents)
          .map((share) => (
            <View key={share.user_id} style={styles.shareRow}>
              <Text style={styles.shareName}>{nameFor(share.user_id)}</Text>
              <Text style={styles.sharevalue}>{formatCents(share.share_cents)}</Text>
            </View>
          ))}
      </Card>

      <ReceiptSection
        expenseId={expense.id}
        householdId={expense.household_id}
        path={expense.receipt_path}
        onChanged={load}
      />

      {error && <ErrorText>{error}</ErrorText>}

      <Button title="Bearbeiten" onPress={() => setEditing(true)} />
      <Button title="Löschen" variant="danger" onPress={remove} />
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  amount: { fontSize: 32, fontWeight: "700", color: colors.text },
  title: { fontSize: 17, fontWeight: "600", color: colors.text },
  meta: { fontSize: 13, color: colors.subtext },
  note: { fontSize: 14, color: colors.text, marginTop: 4 },
  edited: { fontSize: 12, color: colors.subtext, fontStyle: "italic" },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: colors.subtext, textTransform: "uppercase" },
  shareRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  shareName: { fontSize: 15, color: colors.text },
  sharevalue: { fontSize: 15, color: colors.text, fontVariant: ["tabular-nums"] },
}));
