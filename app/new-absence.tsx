import { useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { supabase } from "../src/lib/supabase";
import { describeError } from "../src/lib/connectivity";
import { useAuth } from "../src/lib/AuthProvider";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { makeStyles } from "../src/lib/theme";
import {
  addDays,
  comingWeekend,
  formatRange,
  formatShort,
  nextWeek,
  todayISO,
} from "../src/lib/dates";
import { Button, Chip, Input, Loading, Muted, SectionTitle } from "../src/components/ui";
import { DateStepper } from "../src/components/Steppers";

type Range = { start: string; end: string };

export default function NewAbsence() {
  const styles = useStyles();
  const { date } = useLocalSearchParams<{ date?: string }>();
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();

  const picked = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayISO();
  const [start, setStart] = useState(picked);
  const [end, setEnd] = useState(picked);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  // Die Schnellwahl speichert beim ersten Tipp — ein Doppeltipp legte sonst zwei Einträge an
  const savingRef = useRef(false);

  if (!session || !activeHousehold) return <Loading />;

  const today = todayISO();
  const tomorrow = addDays(today, 1);

  const presets: { label: string; range: Range }[] = [
    { label: "Heute", range: { start: today, end: today } },
    { label: "Morgen", range: { start: tomorrow, end: tomorrow } },
    { label: "Wochenende", range: comingWeekend() },
    { label: "Nächste Woche", range: nextWeek() },
  ];

  // Der im Kalender angetippte Tag, falls er nicht ohnehin Heute/Morgen ist
  if (picked !== today && picked !== tomorrow) {
    presets.unshift({ label: `Am ${formatShort(picked)}`, range: { start: picked, end: picked } });
  }

  const save = async (range: Range) => {
    if (savingRef.current) return;
    if (range.end < range.start) {
      Alert.alert("Ungültiger Zeitraum", "Das Enddatum liegt vor dem Startdatum.");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    const { error, status } = await supabase.from("absences").insert({
      household_id: activeHousehold.id,
      user_id: session.user.id,
      start_date: range.start,
      end_date: range.end,
      note: note.trim() || null,
    });

    if (error) {
      savingRef.current = false;
      setSaving(false);
      Alert.alert("Fehler", describeError(error, status));
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/calendar");
  };

  const changeStart = (next: string) => {
    setStart(next);
    if (end < next) setEnd(next);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <SectionTitle>Schnell</SectionTitle>
      <View style={styles.chipWrap}>
        {presets.map((preset) => (
          <Chip
            key={preset.label}
            label={preset.label}
            selected={false}
            onPress={() => save(preset.range)}
          />
        ))}
      </View>

      <SectionTitle>Eigener Zeitraum</SectionTitle>
      <DateStepper label="Von" value={start} onChange={changeStart} />
      <DateStepper label="Bis" value={end} onChange={(next) => setEnd(next < start ? start : next)} />
      <Input placeholder="Notiz (optional), z.B. Heimaturlaub" value={note} onChangeText={setNote} />
      <Button
        title={`Melden: ${formatRange(start, end)}`}
        onPress={() => save({ start, end })}
        loading={saving}
      />

      <Muted>
        In Putzplan-Rotationen wirst du für diese Tage übersprungen — die Aufgaben verteilen sich
        automatisch auf die anderen.
      </Muted>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
}));
