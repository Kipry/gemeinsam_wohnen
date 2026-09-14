import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles, useColors } from "../lib/theme";
import { getPushStatus, pushSupported, registerPush } from "../lib/push";
import { Button } from "./ui";

const DISMISSED_KEY = "push_prompt_dismissed_at";
const ASK_AGAIN_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Fragt erst mit einer Erklärung, bevor iOS seinen Dialog zeigt — den gibt es
 * nur ein einziges Mal, ein reflexhaftes „Nicht erlauben" wäre endgültig.
 */
export function PushPrompt() {
  const styles = useStyles();
  const colors = useColors();
  const [visible, setVisible] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!pushSupported) return;
    Promise.all([getPushStatus(), AsyncStorage.getItem(DISMISSED_KEY)]).then(([status, dismissedAt]) => {
      const recentlyDismissed = dismissedAt !== null && Date.now() - Number(dismissedAt) < ASK_AGAIN_AFTER_MS;
      setVisible(status === "undetermined" && !recentlyDismissed);
    });
  }, []);

  if (!visible) return null;

  const enable = async () => {
    setAsking(true);
    await registerPush({ ask: true });
    setAsking(false);
    setVisible(false);
  };

  const later = () => {
    AsyncStorage.setItem(DISMISSED_KEY, String(Date.now()));
    setVisible(false);
  };

  return (
    <View style={styles.card}>
      <Ionicons name="notifications" size={22} color={colors.tint} />
      <View style={styles.body}>
        <Text style={styles.title}>Soll dein Handy Bescheid geben?</Text>
        <Text style={styles.text}>
          Abends, wenn du am nächsten Tag dran bist – und wenn jemand einkaufen geht oder dir was
          schreibt. Einzeln abschaltbar unter Mehr → Mitteilungen.
        </Text>
        <View style={styles.actions}>
          <Button title="Ja, gerne" onPress={enable} loading={asking} style={styles.action} />
          <Button title="Später" variant="secondary" onPress={later} style={styles.action} />
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
