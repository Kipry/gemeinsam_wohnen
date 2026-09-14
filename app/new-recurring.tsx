import { useState } from "react";
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { supabase } from "../src/lib/supabase";
import { useAuth } from "../src/lib/AuthProvider";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { useHouseholdMembers } from "../src/lib/useHouseholdMembers";
import { ExpenseForm, type ExpenseFormValues } from "../src/components/ExpenseForm";
import { Chip, ErrorText, Loading, Muted, SectionTitle } from "../src/components/ui";

const DAYS = [1, 5, 10, 15, 20, 25, 28];

export default function NewRecurring() {
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { members, loading } = useHouseholdMembers(activeHousehold?.id);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading || !session || !activeHousehold) return <Loading />;

  const save = async (values: ExpenseFormValues) => {
    setSaving(true);
    const { error: rpcError } = await supabase.rpc("create_recurring_expense", {
      p_household_id: activeHousehold.id,
      p_title: values.title,
      p_amount_cents: values.amount_cents,
      p_paid_by: values.paid_by,
      p_shares: values.shares,
      p_day_of_month: dayOfMonth,
      p_split_mode: values.split_mode,
      p_category: values.category,
    });
    setSaving(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/recurring");
  };

  return (
    <>
      {error && <ErrorText>{error}</ErrorText>}
      <ExpenseForm
        members={members}
        currentUserId={session.user.id}
        initial={{
          title: "",
          amountExpression: "",
          paid_by: session.user.id,
          split_mode: "equal",
          category: "Nebenkosten",
          note: null,
          participants: members.map((member) => member.id),
          amounts: {},
          weights: {},
        }}
        submitLabel="Feste Kosten anlegen"
        saving={saving}
        onSubmit={save}
        extraFields={
          <View style={styles.block}>
            <SectionTitle>Jeden Monat am</SectionTitle>
            <View style={styles.chipWrap}>
              {DAYS.map((day) => (
                <Chip
                  key={day}
                  label={`${day}.`}
                  selected={dayOfMonth === day}
                  onPress={() => setDayOfMonth(day)}
                />
              ))}
            </View>
            <Muted>
              Die Ausgabe wird ab dann automatisch gebucht — auch rückwirkend, falls die App
              länger nicht offen war.
            </Muted>
          </View>
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
