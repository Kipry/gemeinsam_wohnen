import { Alert, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles, useColors } from "../lib/theme";
import { useOnline } from "../lib/connectivity";
import { Button } from "./ui";

/** Kleiner Hinweis oben rechts, solange der Server nicht erreichbar ist */
export function OfflineBadge() {
  const styles = useStyles();
  const colors = useColors();
  const online = useOnline();
  if (online) return null;

  return (
    <TouchableOpacity
      style={styles.badge}
      onPress={() =>
        Alert.alert(
          "Keine Verbindung",
          "Du siehst den zuletzt geladenen Stand. Die Einkaufsliste kannst du trotzdem abhaken und ergänzen – das wird gesendet, sobald du wieder Netz hast."
        )
      }
      accessibilityRole="button"
      accessibilityLabel="Offline – mehr dazu"
    >
      <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
      <Text style={styles.badgeText}>Offline</Text>
    </TouchableOpacity>
  );
}

/** Statt „WG einrichten": ohne Netz und ohne gespeicherten Stand geht es nicht weiter */
export function OfflineScreen({ onRetry }: { onRetry: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.screen}>
      <Ionicons name="cloud-offline-outline" size={40} color={colors.subtext} />
      <Text style={styles.title}>Keine Verbindung</Text>
      <Text style={styles.text}>Sobald du wieder Netz hast, geht es hier weiter.</Text>
      <Button title="Erneut versuchen" variant="secondary" onPress={onRetry} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 4, paddingVertical: 6 },
  badgeText: { fontSize: 13, fontWeight: "600", color: colors.warning },
  screen: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    padding: 32,
    backgroundColor: colors.background,
  },
  title: { fontSize: 18, fontWeight: "700", color: colors.text },
  text: { fontSize: 15, color: colors.subtext, textAlign: "center", marginBottom: 8 },
}));
