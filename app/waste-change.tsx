import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../src/lib/supabase";
import { makeStyles, useColors } from "../src/lib/theme";
import { addDays, formatLong, formatShort } from "../src/lib/dates";
import { hapticTap } from "../src/lib/haptics";
import { rhythmText } from "../src/lib/waste";
import { Card, Loading, Muted, SectionTitle } from "../src/components/ui";
import type { WasteBin, WasteBinChange } from "../src/types/database";

/**
 * Eine einzelne Abholung verschieben oder ausfallen lassen — typischerweise rund
 * um Feiertage. Der Rhythmus der Tonne bleibt, wie er ist.
 */
export default function WasteChangeScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { bin: binId, date } = useLocalSearchParams<{ bin: string; date: string }>();
  const [bin, setBin] = useState<WasteBin | null>(null);
  const [change, setChange] = useState<WasteBinChange | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!binId || !date) return;
    Promise.all([
      supabase.from("waste_bins").select("*").eq("id", binId).limit(1),
      supabase.from("waste_bin_changes").select("*").eq("bin_id", binId).eq("original_date", date).limit(1),
    ]).then(([binResult, changeResult]) => {
      setBin(((binResult.data as WasteBin[]) ?? [])[0] ?? null);
      setChange(((changeResult.data as WasteBinChange[]) ?? [])[0] ?? null);
      setLoaded(true);
    });
  }, [binId, date]);

  if (!loaded) return <Loading />;
  if (!bin || !date) return <Muted>Diese Tonne gibt es nicht mehr.</Muted>;

  const close = () => {
    hapticTap();
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/calendar");
  };

  const apply = async (newDate: string | null) => {
    await supabase
      .from("waste_bin_changes")
      .upsert({ bin_id: bin.id, original_date: date, new_date: newDate }, { onConflict: "bin_id,original_date" });
    close();
  };

  const reset = async () => {
    await supabase.from("waste_bin_changes").delete().eq("bin_id", bin.id).eq("original_date", date);
    close();
  };

  const shifts = [-2, -1, 1, 2, 3].map((offset) => addDays(date, offset));
  const current = change ? change.new_date : date;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Ionicons name="trash" size={26} color={colors.waste[bin.kind]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{bin.label}</Text>
          <Text style={styles.meta}>
            Planmäßig {formatLong(date)} · {rhythmText(bin)}
          </Text>
        </View>
      </View>

      <SectionTitle>Abholung verschieben auf</SectionTitle>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        {shifts.map((day) => (
          <Option
            key={day}
            label={formatShort(day)}
            hint={day < date ? "früher" : "später"}
            selected={current === day}
            onPress={() => apply(day)}
          />
        ))}
      </Card>

      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <Option label="Fällt aus" selected={change !== null && change.new_date === null} onPress={() => apply(null)} />
        <Option label={`Wie geplant (${formatShort(date)})`} selected={change === null} onPress={reset} />
      </Card>

      <Muted>Nur diese eine Abholung ändert sich — die Erinnerung am Vorabend zieht mit.</Muted>
    </ScrollView>
  );
}

function Option({
  label,
  hint,
  selected,
  onPress,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <TouchableOpacity style={styles.option} onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }}>
      <Ionicons
        name={selected ? "radio-button-on" : "radio-button-off"}
        size={20}
        color={selected ? colors.tint : colors.subtext}
      />
      <Text style={styles.optionLabel}>{label}</Text>
      {hint && <Text style={styles.optionHint}>{hint}</Text>}
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 },
  title: { fontSize: 18, fontWeight: "700", color: colors.text },
  meta: { fontSize: 13, color: colors.subtext, marginTop: 2 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  optionLabel: { flex: 1, fontSize: 15, color: colors.text },
  optionHint: { fontSize: 13, color: colors.subtext },
}));
