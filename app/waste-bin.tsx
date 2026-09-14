import { useEffect, useMemo, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Alert, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../src/lib/supabase";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { makeStyles, useColors } from "../src/lib/theme";
import { formatShort, todayISO } from "../src/lib/dates";
import { hapticSuccess } from "../src/lib/haptics";
import {
  WASTE_KINDS,
  candidateDates,
  isCollectionDay,
  rhythmText,
  weekdayOf,
  type WasteKind,
} from "../src/lib/waste";
import { Button, Chip, ErrorText, Input, Loading, Muted, SectionTitle } from "../src/components/ui";
import type { WasteBin } from "../src/types/database";

/** Montag zuerst, Werte wie Date.getDay() */
const WEEKDAYS = [
  { value: 1, label: "Mo" },
  { value: 2, label: "Di" },
  { value: 3, label: "Mi" },
  { value: 4, label: "Do" },
  { value: 5, label: "Fr" },
  { value: 6, label: "Sa" },
  { value: 0, label: "So" },
];

const INTERVALS = [
  { value: 1, label: "jede Woche" },
  { value: 2, label: "alle 2 Wochen" },
  { value: 3, label: "alle 3 Wochen" },
  { value: 4, label: "alle 4 Wochen" },
];

const labelFor = (kind: WasteKind) => WASTE_KINDS.find((entry) => entry.kind === kind)?.label ?? "";

export default function WasteBinScreen() {
  const styles = useStyles();
  const colors = useColors();
  const params = useLocalSearchParams<{ id?: string; kind?: WasteKind }>();
  const { activeHousehold } = useHousehold();
  const today = todayISO();

  const [existing, setExisting] = useState<WasteBin | null>(null);
  const [loaded, setLoaded] = useState(!params.id);
  const [kind, setKind] = useState<WasteKind>(params.kind ?? "rest");
  const [label, setLabel] = useState(labelFor(params.kind ?? "rest"));
  const [labelEdited, setLabelEdited] = useState(false);
  const [weekday, setWeekday] = useState(5);
  const [intervalWeeks, setIntervalWeeks] = useState(1);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params.id) return;
    supabase
      .from("waste_bins")
      .select("*")
      .eq("id", params.id)
      .limit(1)
      .then(({ data }) => {
        const bin = ((data as WasteBin[]) ?? [])[0];
        if (bin) {
          setExisting(bin);
          setKind(bin.kind);
          setLabel(bin.label);
          setLabelEdited(true);
          setWeekday(weekdayOf(bin.first_date));
          setIntervalWeeks(bin.interval_weeks);
          // Die kommende Abholung im bestehenden Rhythmus vorauswählen
          const candidates = candidateDates(weekdayOf(bin.first_date), bin.interval_weeks, todayISO());
          setAnchor(candidates.find((date) => isCollectionDay(bin, date)) ?? candidates[0]);
        }
        setLoaded(true);
      });
  }, [params.id]);

  const candidates = useMemo(
    () => candidateDates(weekday, intervalWeeks, today),
    [weekday, intervalWeeks, today]
  );
  const firstDate = anchor && candidates.includes(anchor) ? anchor : candidates[0];

  if (!loaded || !activeHousehold) return <Loading />;

  const chooseKind = (next: WasteKind) => {
    setKind(next);
    if (!labelEdited) setLabel(labelFor(next));
  };

  const save = async () => {
    if (!label.trim()) {
      setError("Bitte einen Namen eingeben.");
      return;
    }
    setSaving(true);
    setError(null);

    if (existing) {
      // Gleicher Rhythmus: Startdatum und Verschiebungen bleiben unangetastet
      const sameRule = existing.interval_weeks === intervalWeeks && isCollectionDay(existing, firstDate);
      const { error: updateError } = await supabase
        .from("waste_bins")
        .update({
          kind,
          label: label.trim(),
          ...(sameRule ? {} : { first_date: firstDate, interval_weeks: intervalWeeks }),
        })
        .eq("id", existing.id);
      if (!updateError && !sameRule) {
        // Alte Verschiebungen passen nicht mehr zum neuen Rhythmus
        await supabase.from("waste_bin_changes").delete().eq("bin_id", existing.id);
      }
      if (updateError) {
        setSaving(false);
        setError(updateError.message);
        return;
      }
    } else {
      const { error: insertError } = await supabase.from("waste_bins").insert({
        household_id: activeHousehold.id,
        kind,
        label: label.trim(),
        first_date: firstDate,
        interval_weeks: intervalWeeks,
      });
      if (insertError) {
        setSaving(false);
        setError(insertError.message);
        return;
      }
    }

    setSaving(false);
    hapticSuccess();
    if (router.canGoBack()) router.back();
    else router.replace("/waste");
  };

  const remove = () => {
    if (!existing) return;
    Alert.alert(`„${existing.label}" löschen?`, "Die Abholtermine verschwinden aus dem Kalender.", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Löschen",
        style: "destructive",
        onPress: async () => {
          await supabase.from("waste_bins").delete().eq("id", existing.id);
          if (router.canGoBack()) router.back();
          else router.replace("/waste");
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <SectionTitle>Tonne</SectionTitle>
      <View style={styles.chipWrap}>
        {WASTE_KINDS.map((entry) => {
          const selected = entry.kind === kind;
          return (
            <TouchableOpacity
              key={entry.kind}
              style={[styles.kindChip, selected && styles.kindChipSelected]}
              onPress={() => chooseKind(entry.kind)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <Ionicons name="trash" size={15} color={selected ? colors.primaryText : colors.waste[entry.kind]} />
              <Text style={[styles.kindText, selected && styles.kindTextSelected]}>{entry.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Input
        value={label}
        onChangeText={(value) => {
          setLabel(value);
          setLabelEdited(true);
        }}
        placeholder="z.B. Glas oder Sperrmüll"
        accessibilityLabel="Name"
      />

      <SectionTitle>Abholtag</SectionTitle>
      <View style={styles.chipWrap}>
        {WEEKDAYS.map((day) => (
          <Chip key={day.value} label={day.label} selected={weekday === day.value} onPress={() => setWeekday(day.value)} />
        ))}
      </View>

      <SectionTitle>Rhythmus</SectionTitle>
      <View style={styles.chipWrap}>
        {INTERVALS.map((entry) => (
          <Chip
            key={entry.value}
            label={entry.label}
            selected={intervalWeeks === entry.value}
            onPress={() => setIntervalWeeks(entry.value)}
          />
        ))}
      </View>

      {intervalWeeks > 1 && (
        <>
          <SectionTitle>Nächste Abholung</SectionTitle>
          <View style={styles.chipWrap}>
            {candidates.map((date) => (
              <Chip
                key={date}
                label={date === today ? "heute" : formatShort(date)}
                selected={firstDate === date}
                onPress={() => setAnchor(date)}
              />
            ))}
          </View>
          <Muted>Daran erkennt die App, in welchen Wochen abgeholt wird.</Muted>
        </>
      )}

      <View style={styles.preview}>
        <Ionicons name="calendar-outline" size={18} color={colors.tint} />
        <Text style={styles.previewText}>
          {label.trim() || "Tonne"}: {rhythmText({ first_date: firstDate, interval_weeks: intervalWeeks })}, nächste
          Abholung {firstDate === today ? "heute" : formatShort(firstDate)}
        </Text>
      </View>

      {error && <ErrorText>{error}</ErrorText>}

      <Button title={existing ? "Speichern" : "Eintragen"} onPress={save} loading={saving} />
      {existing && <Button title="Löschen" variant="danger" onPress={remove} />}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kindChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  kindChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  kindText: { fontSize: 14, color: colors.text },
  kindTextSelected: { color: colors.primaryText, fontWeight: "600" },
  preview: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 6,
  },
  previewText: { flex: 1, fontSize: 14, color: colors.text },
}));
