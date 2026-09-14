import { useCallback, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { Alert, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../src/lib/supabase";
import { hapticSuccess } from "../src/lib/haptics";
import { useAuth } from "../src/lib/AuthProvider";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { useHouseholdMembers } from "../src/lib/useHouseholdMembers";
import { makeStyles, useColors } from "../src/lib/theme";
import { formatShort, todayISO } from "../src/lib/dates";
import { ExpenseForm, type ExpenseFormValues } from "../src/components/ExpenseForm";
import { ReceiptPicker } from "../src/components/ReceiptPicker";
import { attachReceipt, type PickedReceipt } from "../src/lib/receipts";
import { Empty, ErrorText, Loading } from "../src/components/ui";
import type { ShoppingItem, ShoppingTrip } from "../src/types/database";

export default function FinishTrip() {
  const styles = useStyles();
  const colors = useColors();
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { members, loading: membersLoading } = useHouseholdMembers(activeHousehold?.id);
  const [trip, setTrip] = useState<ShoppingTrip | null>(null);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<PickedReceipt | null>(null);

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
    const { data, error: rpcError } = await supabase.rpc("finish_shopping_trip", {
      p_trip_id: trip.id,
      p_total_cents: values.amount_cents,
      p_paid_by: values.paid_by,
      p_shares: values.shares,
      p_title: values.title,
      p_split_mode: values.split_mode,
      p_store: trip.store,
    });

    if (rpcError || !data) {
      setSaving(false);
      setError(rpcError?.message ?? "Einkauf konnte nicht abgerechnet werden");
      return;
    }
    hapticSuccess();

    const expenseId = (data as { id: string }).id;

    if (receipt && activeHousehold) {
      try {
        await attachReceipt(activeHousehold.id, expenseId, receipt);
      } catch (uploadError: any) {
        // Abgerechnet ist schon — nicht zurück ins Formular, sonst doppelt
        setSaving(false);
        Alert.alert(
          "Beleg nicht hochgeladen",
          `Der Einkauf ist abgerechnet. Den Beleg kannst du in der Ausgabe nachreichen.\n\n${uploadError?.message ?? ""}`
        );
        router.replace(`/expense/${expenseId}`);
        return;
      }
    }

    setSaving(false);
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/shopping");
  };

  return (
    <>
      <View style={styles.header}>
        <Ionicons name="basket" size={18} color={colors.tint} />
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
        extraFields={<ReceiptPicker value={receipt} onChange={setReceipt} />}
      />
    </>
  );
}

const useStyles = makeStyles((colors) => ({
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
}));
