import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles, useColors } from "../lib/theme";
import { useHousehold } from "../lib/HouseholdProvider";
import { confirmChoreRestart, useRestartSuggestion } from "../lib/choreRestart";
import { Button } from "./ui";

/**
 * Einmal, wenn der letzte Platzhalter übernommen wurde: Jetzt sind alle da —
 * ein fairer Start, bevor die Statistik von der Anfangszeit verzerrt bleibt.
 */
export function RestartPrompt({
  openPlaceholders,
  placeholdersLoading,
  onRestarted,
}: {
  openPlaceholders: number;
  placeholdersLoading: boolean;
  onRestarted: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { activeHousehold, refresh } = useHousehold();
  const { show, dismiss } = useRestartSuggestion(activeHousehold, openPlaceholders, placeholdersLoading);

  if (!show || !activeHousehold) return null;

  const restart = () =>
    confirmChoreRestart(activeHousehold.id, async () => {
      await refresh();
      onRestarted();
    });

  return (
    <View style={styles.card}>
      <Ionicons name="people" size={22} color={colors.tint} />
      <View style={styles.body}>
        <Text style={styles.title}>Alle sind eingezogen</Text>
        <Text style={styles.text}>
          Sollen die Punkte ab heute für alle neu zählen? Liegengebliebenes aus der Anfangszeit fällt
          dann weg.
        </Text>
        <View style={styles.actions}>
          <Button title="Neu starten" onPress={restart} style={styles.action} />
          <Button title="Nein, danke" variant="secondary" onPress={dismiss} style={styles.action} />
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    flexDirection: "row",
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  body: { flex: 1, gap: 6 },
  title: { fontSize: 15, fontWeight: "700", color: colors.text },
  text: { fontSize: 13, lineHeight: 18, color: colors.subtext },
  actions: { flexDirection: "row", gap: 8, marginTop: 4 },
  action: { flex: 1 },
}));
