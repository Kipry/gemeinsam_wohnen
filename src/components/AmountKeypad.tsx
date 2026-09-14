import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles, useColors } from "../lib/theme";
import { applyKey, evaluateAmountExpression, isCalculation } from "../lib/calc";
import { formatCents } from "../lib/money";

const KEYS = [
  ["7", "8", "9", "÷"],
  ["4", "5", "6", "×"],
  ["1", "2", "3", "−"],
  [",", "0", "⌫", "+"],
];

const OPERATORS = ["+", "−", "×", "÷"];

export function AmountKeypad({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.keypad}>
      {KEYS.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {row.map((key) => {
            const isOperator = OPERATORS.includes(key);
            const isBackspace = key === "⌫";
            return (
              <TouchableOpacity
                key={key}
                style={[styles.key, isOperator && styles.operatorKey]}
                onPress={() => onChange(applyKey(value, key))}
              >
                {isBackspace ? (
                  <Ionicons name="backspace-outline" size={22} color={colors.text} />
                ) : (
                  <Text style={[styles.keyText, isOperator && styles.operatorText]}>{key}</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** Große Betragsanzeige mit Live-Zwischenergebnis der Rechnung. */
export function AmountDisplay({
  value,
  onPress,
  active,
}: {
  value: string;
  onPress?: () => void;
  active?: boolean;
}) {
  const styles = useStyles();
  const cents = evaluateAmountExpression(value);
  const showResult = isCalculation(value) && cents !== null;

  return (
    <TouchableOpacity style={[styles.display, active && styles.displayActive]} onPress={onPress}>
      <Text style={styles.displayLabel}>Betrag</Text>
      <Text style={[styles.displayValue, !value && styles.displayPlaceholder]} numberOfLines={1}>
        {value ? `${value} €` : "0,00 €"}
      </Text>
      {showResult && <Text style={styles.displayResult}>= {formatCents(cents)}</Text>}
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((colors) => ({
  display: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  displayActive: { borderColor: colors.primary },
  displayLabel: { fontSize: 12, color: colors.subtext },
  displayValue: { fontSize: 32, fontWeight: "700", color: colors.text },
  displayPlaceholder: { color: colors.subtext },
  displayResult: { fontSize: 15, fontWeight: "600", color: colors.tint },
  keypad: {
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: 8,
    gap: 8,
  },
  row: { flexDirection: "row", gap: 8 },
  key: {
    flex: 1,
    height: 52,
    borderRadius: 10,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
  operatorKey: { backgroundColor: colors.border },
  keyText: { fontSize: 22, color: colors.text, fontWeight: "500" },
  operatorText: { fontWeight: "700" },
}));
