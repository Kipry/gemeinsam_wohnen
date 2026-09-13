import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../src/lib/supabase";
import { useAuth } from "../src/lib/AuthProvider";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { useHouseholdMembers } from "../src/lib/useHouseholdMembers";
import { colors } from "../src/lib/theme";
import { addDays, comingWeekend, formatRange, formatShort, nextWeek, todayISO } from "../src/lib/dates";
import { Button, Chip, Empty, Input, Muted, Screen, SectionTitle, UndoToast } from "../src/components/ui";
import type { Absence } from "../src/types/database";

type Preset = { label: string; range: () => { start: string; end: string } };

const PRESETS: Preset[] = [
  { label: "Heute", range: () => ({ start: todayISO(), end: todayISO() }) },
  { label: "Morgen", range: () => ({ start: addDays(todayISO(), 1), end: addDays(todayISO(), 1) }) },
  { label: "Wochenende", range: comingWeekend },
  { label: "Nächste Woche", range: nextWeek },
];

export default function AbsencesScreen() {
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(todayISO());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [undo, setUndo] = useState<Absence | null>(null);

  const load = useCallback(async () => {
    if (!activeHousehold) return;
    const { data, error } = await supabase
      .from("absences")
      .select("*")
      .eq("household_id", activeHousehold.id)
      .gte("end_date", todayISO())
      .order("start_date");

    if (error) console.error(error);
    setAbsences(data ?? []);
  }, [activeHousehold]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const nameFor = (userId: string) =>
    userId === session?.user.id ? "Du" : members.find((m) => m.id === userId)?.full_name ?? "?";

  const add = async (range: { start: string; end: string }) => {
    if (!session || !activeHousehold) return;
    if (range.end < range.start) {
      Alert.alert("Ungültiger Zeitraum", "Das Enddatum liegt vor dem Startdatum.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("absences").insert({
      household_id: activeHousehold.id,
      user_id: session.user.id,
      start_date: range.start,
      end_date: range.end,
      note: note.trim() || null,
    });
    setSaving(false);

    if (error) {
      Alert.alert("Fehler", error.message);
      return;
    }
    setNote("");
    setCustomOpen(false);
    load();
  };

  const remove = async (absence: Absence) => {
    if (absence.user_id !== session?.user.id) return;
    setAbsences((prev) => prev.filter((entry) => entry.id !== absence.id));
    setUndo(absence);
    await supabase.from("absences").delete().eq("id", absence.id);
  };

  const undoRemove = async () => {
    if (!undo || !activeHousehold) return;
    await supabase.from("absences").insert({
      household_id: undo.household_id,
      user_id: undo.user_id,
      start_date: undo.start_date,
      end_date: undo.end_date,
      note: undo.note,
    });
    setUndo(null);
    load();
  };

  const awayToday = absences.filter(
    (entry) => entry.start_date <= todayISO() && entry.end_date >= todayISO()
  );

  return (
    <Screen>
      <View style={styles.form}>
        <SectionTitle>Ich bin weg</SectionTitle>
        <View style={styles.chipWrap}>
          {PRESETS.map((preset) => (
            <Chip
              key={preset.label}
              label={preset.label}
              selected={false}
              onPress={() => add(preset.range())}
            />
          ))}
          <Chip label="Zeitraum…" selected={customOpen} onPress={() => setCustomOpen(!customOpen)} />
        </View>

        {customOpen && (
          <View style={styles.custom}>
            <DateStepper label="Von" value={start} onChange={setStart} />
            <DateStepper label="Bis" value={end} onChange={setEnd} />
            <Input placeholder="Notiz (optional)" value={note} onChangeText={setNote} />
            <Button
              title={`Melden: ${formatRange(start, end)}`}
              onPress={() => add({ start, end })}
              loading={saving}
            />
          </View>
        )}

        <Muted>In Putzplan-Rotationen werden abwesende Personen automatisch übersprungen.</Muted>
      </View>

      {awayToday.length > 0 && (
        <View style={styles.todayBanner}>
          <Ionicons name="airplane" size={16} color={colors.primary} />
          <Text style={styles.todayText}>
            Heute nicht da: {awayToday.map((entry) => nameFor(entry.user_id)).join(", ")}
          </Text>
        </View>
      )}

      <FlatList
        data={absences}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        ListEmptyComponent={<Empty>Aktuell ist niemand abwesend gemeldet.</Empty>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{nameFor(item.user_id)}</Text>
              <Text style={styles.rowSubtitle}>
                {formatRange(item.start_date, item.end_date)}
                {item.note ? ` · ${item.note}` : ""}
              </Text>
            </View>
            {item.user_id === session?.user.id && (
              <TouchableOpacity onPress={() => remove(item)} style={styles.iconButton}>
                <Ionicons name="trash-outline" size={18} color={colors.subtext} />
              </TouchableOpacity>
            )}
          </View>
        )}
      />

      <UndoToast
        message={undo ? "Abwesenheit gelöscht" : null}
        onUndo={undoRemove}
        onHide={() => setUndo(null)}
      />
    </Screen>
  );
}

function DateStepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <TouchableOpacity onPress={() => onChange(addDays(value, -1))} style={styles.stepperButton}>
        <Ionicons name="chevron-back" size={18} color={colors.text} />
      </TouchableOpacity>
      <Text style={styles.stepperValue}>{formatShort(value)}</Text>
      <TouchableOpacity onPress={() => onChange(addDays(value, 1))} style={styles.stepperButton}>
        <Ionicons name="chevron-forward" size={18} color={colors.text} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    padding: 16,
    gap: 10,
    backgroundColor: colors.card,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  custom: { gap: 8, marginTop: 4 },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepperLabel: { fontSize: 14, color: colors.subtext, width: 34 },
  stepperButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  stepperValue: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.text, textAlign: "center" },
  todayBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.background,
  },
  todayText: { fontSize: 13, color: colors.text },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 12,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  rowSubtitle: { fontSize: 13, color: colors.subtext, marginTop: 2 },
  iconButton: { padding: 6 },
});
