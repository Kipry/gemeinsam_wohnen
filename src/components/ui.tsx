import { useEffect, type ReactNode } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { makeStyles, useColors } from "../lib/theme";

export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const styles = useStyles();
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const styles = useStyles();
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <Text style={styles.muted}>{children}</Text>;
}

export function Empty({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <Text style={styles.empty}>{children}</Text>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <Text style={styles.error}>{children}</Text>;
}

export function Loading() {
  const styles = useStyles();
  return (
    <View style={styles.center}>
      <ActivityIndicator />
    </View>
  );
}

export function Input(props: TextInputProps) {
  const styles = useStyles();
  const colors = useColors();
  return <TextInput placeholderTextColor={colors.subtext} {...props} style={[styles.input, props.style]} />;
}

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "success";
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const styles = useStyles();
  const colors = useColors();
  const background = {
    primary: colors.primary,
    secondary: colors.border,
    danger: colors.danger,
    success: colors.success,
  }[variant];

  return (
    <TouchableOpacity
      style={[styles.button, { backgroundColor: background }, (disabled || loading) && styles.disabled, style]}
      onPress={onPress}
      disabled={disabled || loading}
    >
      {loading ? (
        <ActivityIndicator color={variant === "secondary" ? colors.text : "#fff"} />
      ) : (
        <Text style={[styles.buttonText, variant === "secondary" && { color: colors.text }]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

/** Auswahl aus wenigen Optionen (z.B. Zuteilungsmodus, Beteiligte). */
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <TouchableOpacity style={[styles.chip, selected && styles.chipSelected]} onPress={onPress}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

/**
 * Kurz eingeblendete Leiste mit "Rückgängig".
 * Verschwindet nach `timeoutMs` von selbst.
 */
export function UndoToast({
  message,
  onUndo,
  onHide,
  timeoutMs = 8000,
}: {
  message: string | null;
  onUndo: () => void;
  onHide: () => void;
  timeoutMs?: number;
}) {
  const styles = useStyles();
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onHide, timeoutMs);
    return () => clearTimeout(timer);
  }, [message, timeoutMs, onHide]);

  if (!message) return null;

  return (
    <View style={styles.undo}>
      <Text style={styles.undoText} numberOfLines={1}>
        {message}
      </Text>
      <TouchableOpacity onPress={onUndo}>
        <Text style={styles.undoAction}>Rückgängig</Text>
      </TouchableOpacity>
    </View>
  );
}

export function Row({
  title,
  subtitle,
  right,
  onPress,
  onLongPress,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const styles = useStyles();
  const Wrapper: any = onPress || onLongPress ? TouchableOpacity : View;
  return (
    <Wrapper style={styles.row} onPress={onPress} onLongPress={onLongPress}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </Wrapper>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderColor: colors.border,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: colors.subtext, textTransform: "uppercase" },
  muted: { fontSize: 13, color: colors.subtext },
  empty: { textAlign: "center", color: colors.subtext, marginTop: 32 },
  error: { color: colors.dangerText, textAlign: "center" },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
  },
  button: { borderRadius: 10, paddingVertical: 13, paddingHorizontal: 16, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  disabled: { opacity: 0.5 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextSelected: { color: "#fff", fontWeight: "600" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  rowSubtitle: { fontSize: 13, color: colors.subtext, marginTop: 2 },
  undo: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.toast,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  undoText: { flex: 1, color: colors.toastText, fontSize: 14 },
  undoAction: { color: colors.toastText, fontSize: 14, fontWeight: "700", textDecorationLine: "underline" },
}));
