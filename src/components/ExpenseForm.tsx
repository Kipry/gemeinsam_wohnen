import { useMemo, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../lib/theme";
import { FORMER_MEMBER } from "../lib/useHouseholdMembers";
import { evaluateAmountExpression } from "../lib/calc";
import { formatCents, parseAmountToCents, splitByWeights, splitEqually } from "../lib/money";
import { AmountDisplay, AmountKeypad } from "./AmountKeypad";
import { Button, Chip, ErrorText, Input, Muted, SectionTitle } from "./ui";
import type { Profile } from "../types/database";

/** 4 Reihen à 52 + Abstände + Innenabstand des Keypads */
const KEYPAD_HEIGHT = 248;

export const CATEGORIES = [
  "Lebensmittel",
  "Drogerie",
  "Haushalt",
  "Getränke",
  "Essen bestellt",
  "Nebenkosten",
  "Sonstiges",
];

export type SplitMode = "equal" | "amounts" | "weights";

export type ExpenseFormValues = {
  title: string;
  amount_cents: number;
  paid_by: string;
  split_mode: SplitMode;
  category: string | null;
  note: string | null;
  shares: { user_id: string; share_cents: number; weight?: number }[];
};

export type ExpenseFormInitial = {
  title: string;
  amountExpression: string;
  paid_by: string;
  split_mode: SplitMode;
  category: string | null;
  note: string | null;
  participants: string[];
  amounts: Record<string, string>;
  weights: Record<string, number>;
};

export function ExpenseForm({
  members,
  currentUserId,
  initial,
  submitLabel,
  saving,
  onSubmit,
  extraFields,
}: {
  members: Profile[];
  currentUserId: string;
  initial?: ExpenseFormInitial;
  submitLabel: string;
  saving: boolean;
  onSubmit: (values: ExpenseFormValues) => void;
  /** Zusätzliche Felder, z.B. der Buchungstag bei festen Kosten */
  extraFields?: ReactNode;
}) {
  const [amount, setAmount] = useState(initial?.amountExpression ?? "");
  // Betrag ist immer das Erste — Keypad offen, solange noch keiner drinsteht
  const [keypadOpen, setKeypadOpen] = useState(!initial?.amountExpression);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState<string | null>(initial?.category ?? null);
  const [paidBy, setPaidBy] = useState(initial?.paid_by ?? currentUserId);
  const [participants, setParticipants] = useState<string[] | null>(initial?.participants ?? null);
  const [splitMode, setSplitMode] = useState<SplitMode>(initial?.split_mode ?? "equal");
  const [amounts, setAmounts] = useState<Record<string, string>>(initial?.amounts ?? {});
  const [weights, setWeights] = useState<Record<string, number>>(initial?.weights ?? {});
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState<string | null>(null);

  const selected = participants ?? members.map((m) => m.id);
  const totalCents = evaluateAmountExpression(amount);

  const shares = useMemo(() => {
    if (totalCents === null) return {};
    if (splitMode === "equal") return splitEqually(totalCents, selected);
    if (splitMode === "weights") {
      const active: Record<string, number> = {};
      for (const id of selected) active[id] = weights[id] ?? 1;
      return splitByWeights(totalCents, active);
    }
    const result: Record<string, number> = {};
    for (const id of selected) result[id] = parseAmountToCents(amounts[id] ?? "") ?? 0;
    return result;
  }, [totalCents, splitMode, selected, weights, amounts]);

  const sharesSum = Object.values(shares).reduce((sum, cents) => sum + cents, 0);
  const difference = totalCents === null ? 0 : totalCents - sharesSum;

  const nameFor = (id: string) =>
    id === currentUserId ? "Du" : members.find((m) => m.id === id)?.full_name ?? FORMER_MEMBER;

  const toggleParticipant = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setParticipants(next);
  };

  const pickCategory = (value: string) => {
    const next = category === value ? null : value;
    setCategory(next);
    // Titel mitziehen, solange er nur die Kategorie enthält
    if (!title || CATEGORIES.includes(title)) setTitle(next ?? "");
  };

  const setWeight = (id: string, delta: number) => {
    setWeights((prev) => {
      const current = prev[id] ?? 1;
      return { ...prev, [id]: Math.max(1, Math.min(20, current + delta)) };
    });
  };

  const submit = () => {
    if (totalCents === null || totalCents <= 0) {
      return setError("Bitte einen gültigen Betrag eingeben.");
    }
    if (selected.length === 0) {
      return setError("Bitte mindestens eine beteiligte Person wählen.");
    }
    if (sharesSum !== totalCents) {
      return setError(
        `Die Anteile ergeben ${formatCents(sharesSum)}, der Betrag ist ${formatCents(totalCents)}.`
      );
    }

    setError(null);
    onSubmit({
      title: title.trim() || category || "Ausgabe",
      amount_cents: totalCents,
      paid_by: paidBy,
      split_mode: splitMode,
      category,
      note: note.trim() || null,
      shares: selected.map((id) => ({
        user_id: id,
        share_cents: shares[id] ?? 0,
        weight: splitMode === "weights" ? weights[id] ?? 1 : undefined,
      })),
    });
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ flex: 1 }}
        // Das Keypad liegt über dem Formular — ohne diesen Freiraum bleibt der
        // Speichern-Knopf darunter verborgen und ist nicht antippbar.
        contentContainerStyle={[styles.content, keypadOpen && { paddingBottom: KEYPAD_HEIGHT + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <AmountDisplay value={amount} active={keypadOpen} onPress={() => setKeypadOpen(!keypadOpen)} />

        <SectionTitle>Wofür</SectionTitle>
        <View style={styles.chipWrap}>
          {CATEGORIES.map((entry) => (
            <Chip
              key={entry}
              label={entry}
              selected={category === entry}
              onPress={() => {
                setKeypadOpen(false);
                pickCategory(entry);
              }}
            />
          ))}
        </View>
        <Input
          placeholder="Eigener Titel (optional)"
          value={title}
          onChangeText={setTitle}
          onFocus={() => setKeypadOpen(false)}
        />

        <SectionTitle>Bezahlt von</SectionTitle>
        <View style={styles.chipWrap}>
          {members.map((member) => (
            <Chip
              key={member.id}
              label={nameFor(member.id)}
              selected={paidBy === member.id}
              onPress={() => {
                setKeypadOpen(false);
                setPaidBy(member.id);
              }}
            />
          ))}
        </View>

        <SectionTitle>Wer trägt die Kosten mit</SectionTitle>
        <View style={styles.checkList}>
          {members.map((member) => {
            const isOn = selected.includes(member.id);
            return (
              <TouchableOpacity
                key={member.id}
                style={styles.checkRow}
                onPress={() => {
                  setKeypadOpen(false);
                  toggleParticipant(member.id);
                }}
              >
                <Ionicons
                  name={isOn ? "checkbox" : "square-outline"}
                  size={22}
                  color={isOn ? colors.primary : colors.subtext}
                />
                <Text style={styles.checkName}>{nameFor(member.id)}</Text>

                {isOn && splitMode === "weights" && (
                  <View style={styles.stepper}>
                    <TouchableOpacity onPress={() => setWeight(member.id, -1)} style={styles.stepperButton}>
                      <Ionicons name="remove" size={16} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={styles.stepperValue}>{weights[member.id] ?? 1}</Text>
                    <TouchableOpacity onPress={() => setWeight(member.id, 1)} style={styles.stepperButton}>
                      <Ionicons name="add" size={16} color={colors.text} />
                    </TouchableOpacity>
                  </View>
                )}

                {isOn && splitMode === "amounts" && (
                  <Input
                    style={styles.amountInput}
                    placeholder="0,00"
                    value={amounts[member.id] ?? ""}
                    onChangeText={(value) => setAmounts((prev) => ({ ...prev, [member.id]: value }))}
                    onFocus={() => setKeypadOpen(false)}
                    keyboardType="decimal-pad"
                  />
                )}

                {isOn && splitMode === "equal" && (
                  <Text style={styles.shareValue}>{formatCents(shares[member.id] ?? 0)}</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <SectionTitle>Aufteilung</SectionTitle>
        <View style={styles.chipWrap}>
          <Chip label="Gleichmäßig" selected={splitMode === "equal"} onPress={() => setSplitMode("equal")} />
          <Chip label="Feste Beträge" selected={splitMode === "amounts"} onPress={() => setSplitMode("amounts")} />
          <Chip label="Anteile" selected={splitMode === "weights"} onPress={() => setSplitMode("weights")} />
        </View>

        {splitMode === "weights" && (
          <Muted>
            Anteile über die Plus- und Minus-Knöpfe: bei 1 / 1 / 2 zahlt die letzte Person doppelt.
          </Muted>
        )}
        {splitMode === "amounts" && totalCents !== null && (
          <Text style={[styles.difference, difference === 0 ? styles.differenceOk : styles.differenceOff]}>
            {difference === 0
              ? `Passt: ${formatCents(sharesSum)} verteilt`
              : difference > 0
                ? `Noch ${formatCents(difference)} zu verteilen`
                : `${formatCents(-difference)} zu viel verteilt`}
          </Text>
        )}

        {extraFields}

        <Input
          placeholder="Notiz (optional)"
          value={note}
          onChangeText={setNote}
          onFocus={() => setKeypadOpen(false)}
        />

        {error && <ErrorText>{error}</ErrorText>}

        <Button title={submitLabel} onPress={submit} loading={saving} />
      </ScrollView>

      {keypadOpen && <AmountKeypad value={amount} onChange={setAmount} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 10, paddingBottom: 32 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  checkList: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  checkName: { flex: 1, fontSize: 15, color: colors.text },
  shareValue: { fontSize: 15, color: colors.subtext, fontVariant: ["tabular-nums"] },
  amountInput: { width: 110, textAlign: "right", paddingVertical: 6 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepperButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  stepperValue: { fontSize: 15, fontWeight: "600", color: colors.text, minWidth: 16, textAlign: "center" },
  difference: { fontSize: 13, fontWeight: "600" },
  differenceOk: { color: colors.success },
  differenceOff: { color: colors.danger },
});
