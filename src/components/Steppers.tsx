import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../lib/theme";
import { addDays, formatShort } from "../lib/dates";

function StepperRow({
  label,
  value,
  onPrev,
  onNext,
}: {
  label: string;
  value: string;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity onPress={onPrev} style={styles.button}>
        <Ionicons name="chevron-back" size={18} color={colors.text} />
      </TouchableOpacity>
      <Text style={styles.value}>{value}</Text>
      <TouchableOpacity onPress={onNext} style={styles.button}>
        <Ionicons name="chevron-forward" size={18} color={colors.text} />
      </TouchableOpacity>
    </View>
  );
}

/** Datum tageweise vor- und zurückschalten — kein JJJJ-MM-TT abtippen. */
export function DateStepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <StepperRow
      label={label}
      value={formatShort(value)}
      onPrev={() => onChange(addDays(value, -1))}
      onNext={() => onChange(addDays(value, 1))}
    />
  );
}

/** Uhrzeit in 30-Minuten-Schritten, Format "HH:MM". */
export function TimeStepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const shift = (minutes: number) => {
    const [hours, mins] = value.split(":").map(Number);
    const total = (((hours * 60 + mins + minutes) % 1440) + 1440) % 1440;
    const nextHours = String(Math.floor(total / 60)).padStart(2, "0");
    const nextMinutes = String(total % 60).padStart(2, "0");
    onChange(`${nextHours}:${nextMinutes}`);
  };

  return (
    <StepperRow
      label={label}
      value={`${value} Uhr`}
      onPrev={() => shift(-30)}
      onNext={() => shift(30)}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  label: { fontSize: 14, color: colors.subtext, width: 34 },
  button: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  value: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.text, textAlign: "center" },
});
