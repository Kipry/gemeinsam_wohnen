import { useCallback, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../src/lib/supabase";
import { useAuth } from "../src/lib/AuthProvider";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { useHouseholdMembers } from "../src/lib/useHouseholdMembers";
import { colors } from "../src/lib/theme";
import { formatShort, todayISO } from "../src/lib/dates";
import { ExpenseForm, type ExpenseFormValues } from "../src/components/ExpenseForm";
import { Empty, ErrorText, Loading } from "../src/components/ui";
import type { ShoppingItem, ShoppingTrip } from "../src/types/database";

export default function FinishTrip() {
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { members, loading: membersLoading } = useHouseholdMembers(activeHousehold?.id);
  const [trip, setTrip] = useState<ShoppingTrip | null>(null);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeHousehold || !session) return;

    const { data: tripRow } = await supabase
      .from("shopping_trips")
      .select("*")
      .eq("household_id", activeHousehold.id)
      .eq("shopper", session.user.id)
      .is("finished_at", null)
      .maybeSingle();

    setTrip((tripRow as ShoppingTrip) ?? null);

    if (tripRow) {
      const { data: itemRows } = await supabase
        .from("shopping_items")
        .select("*")
        .eq("trip_id", (tripRow as ShoppingTrip).id)
        .is("deleted_at", null);
      setItems((itemRows as ShoppingItem[]) ?? []);
    }
    setLoading(false);
  }, [activeHousehold, session]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Erst rendern, wenn die Mitglieder da sind — sonst startet das Formular
  // mit einer leeren Beteiligtenliste statt mit allen Mitbewohnern.
  if (loading || membersLoading) return <Loading />;
  if (!trip || !session) {
    return <Empty>Kein laufender Einkauf.</Empty>;
  }

  const save = async (values: ExpenseFormValues) => {
    setSaving(true);
    const { error: rpcError } = await supabase.rpc("finish_shopping_trip", {
      p_trip_id: trip.id,
      p_total_cents: values.amount_cents,
      p_paid_by: values.paid_by,
      p_shares: values.shares,
      p_title: values.title,
      p_split_mode: values.split_mode,
      p_store: trip.store,
    });
    setSaving(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/shopping");
  };

  return (
    <>
      <View style={styles.header}>
        <Ionicons name="basket" size={18} color={colors.primary} />
        <Text style={styles.headerText}>
          {items.length} {items.length === 1 ? "Artikel" : "Artikel"} ·{" "}
          {items
            .slice(0, 4)
            .map((item) => item.name)
            .join(", ")}
          {items.length > 4 ? " …" : ""}
        </Text>
      </View>

      {error && <ErrorText>{error}</ErrorText>}

      <ExpenseForm
        members={members}
        currentUserId={session.user.id}
        initial={{
          title: trip.store ?? `Einkauf ${formatShort(todayISO())}`,
          amountExpression: "",
          paid_by: session.user.id,
          split_mode: "equal",
          category: "Lebensmittel",
          note: null,
          participants: members.map((member) => member.id),
          amounts: {},
          weights: {},
        }}
        submitLabel="Als Ausgabe eintragen"
        saving={saving}
        onSubmit={save}
      />
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerText: { flex: 1, fontSize: 13, color: colors.subtext },
});
