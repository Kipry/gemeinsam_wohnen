import { useMemo, useState } from "react";
import { router } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { supabase } from "../src/lib/supabase";
import { useAuth } from "../src/lib/AuthProvider";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { useHouseholdMembers } from "../src/lib/useHouseholdMembers";
import { colors } from "../src/lib/theme";
import { formatCents, parseAmountToCents, splitEqually } from "../src/lib/money";
import { Button, Chip, ErrorText, Input, Muted, SectionTitle } from "../src/components/ui";

export default function NewExpense() {
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);

  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState<string | null>(session?.user.id ?? null);
  const [participants, setParticipants] = useState<string[] | null>(null);
  const [splitMode, setSplitMode] = useState<"equal" | "custom">("equal");
  const [customShares, setCustomShares] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Standardmäßig sind alle Mitbewohner beteiligt.
  const selected = participants ?? members.map((m) => m.id);
  const totalCents = parseAmountToCents(amount);

  const shares = useMemo(() => {
    if (totalCents === null) return {};
    if (splitMode === "equal") return splitEqually(totalCents, selected);

    const result: Record<string, number> = {};
    for (const id of selected) {
      result[id] = parseAmountToCents(customShares[id] ?? "") ?? 0;
    }
    return result;
  }, [totalCents, splitMode, selected, customShares]);

  const sharesSum = Object.values(shares).reduce((sum, cents) => sum + cents, 0);

  const toggleParticipant = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setParticipants(next);
  };

  const save = async () => {
    if (!activeHousehold || !session) return;
    if (!title.trim()) return setError("Bitte einen Titel eingeben.");
    if (totalCents === null || totalCents <= 0) return setError("Bitte einen gültigen Betrag eingeben.");
    if (!paidBy) return setError("Bitte auswählen, wer bezahlt hat.");
    if (selected.length === 0) return setError("Bitte mindestens eine beteiligte Person wählen.");
    if (sharesSum !== totalCents) {
      return setError(
        `Die Anteile ergeben ${formatCents(sharesSum)}, der Betrag ist ${formatCents(totalCents)}.`
      );
    }

    setError(null);
    setSaving(true);

    const { error: rpcError } = await supabase.rpc("create_expense", {
      p_household_id: activeHousehold.id,
      p_title: title.trim(),
      p_amount_cents: totalCents,
      p_paid_by: paidBy,
      p_shares: selected.map((id) => ({ user_id: id, share_cents: shares[id] ?? 0 })),
    });

    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/expenses");
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <SectionTitle>Ausgabe</SectionTitle>
      <Input placeholder="z.B. Großeinkauf Rewe" value={title} onChangeText={setTitle} />
      <Input
        placeholder="Betrag in € (z.B. 42,50)"
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
      />

      <SectionTitle>Bezahlt von</SectionTitle>
      <View style={styles.chipWrap}>
        {members.map((m) => (
          <Chip
            key={m.id}
            label={m.id === session?.user.id ? "Du" : m.full_name}
            selected={paidBy === m.id}
            onPress={() => setPaidBy(m.id)}
          />
        ))}
      </View>

      <SectionTitle>Beteiligt</SectionTitle>
      <View style={styles.chipWrap}>
        {members.map((m) => (
          <Chip
            key={m.id}
            label={m.id === session?.user.id ? "Du" : m.full_name}
            selected={selected.includes(m.id)}
            onPress={() => toggleParticipant(m.id)}
          />
        ))}
      </View>

      <SectionTitle>Aufteilung</SectionTitle>
      <View style={styles.chipWrap}>
        <Chip
          label="Gleichmäßig"
          selected={splitMode === "equal"}
          onPress={() => setSplitMode("equal")}
        />
        <Chip
          label="Individuell"
          selected={splitMode === "custom"}
          onPress={() => setSplitMode("custom")}
        />
      </View>

      {splitMode === "equal" ? (
        <Muted>
          {totalCents && selected.length > 0
            ? `Je ${formatCents(Math.floor(totalCents / selected.length))} pro Person (Restcent wird verteilt).`
            : "Betrag eingeben, um die Aufteilung zu sehen."}
        </Muted>
      ) : (
        <View style={{ gap: 8 }}>
          {selected.map((id) => {
            const member = members.find((m) => m.id === id);
            return (
              <View key={id} style={styles.customRow}>
                <Text style={styles.customName}>
                  {id === session?.user.id ? "Du" : member?.full_name ?? "?"}
                </Text>
                <Input
                  style={styles.customInput}
                  placeholder="0,00"
                  value={customShares[id] ?? ""}
                  onChangeText={(value) => setCustomShares((prev) => ({ ...prev, [id]: value }))}
                  keyboardType="decimal-pad"
                />
              </View>
            );
          })}
          <Muted>
            Summe: {formatCents(sharesSum)}
            {totalCents !== null ? ` von ${formatCents(totalCents)}` : ""}
          </Muted>
        </View>
      )}

      {error && <ErrorText>{error}</ErrorText>}

      <Button title="Ausgabe speichern" onPress={save} loading={saving} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  customRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  customName: { flex: 1, fontSize: 15, color: colors.text },
  customInput: { width: 120, textAlign: "right" },
});
