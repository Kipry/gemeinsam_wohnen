import { Alert, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../lib/theme";
import { cameraAvailable, pickReceipt, type PickedReceipt } from "../lib/receipts";
import { SectionTitle } from "./ui";

/** Beleg vor dem Speichern auswählen; hochgeladen wird erst mit der Ausgabe. */
export function ReceiptPicker({
  value,
  onChange,
}: {
  value: PickedReceipt | null;
  onChange: (next: PickedReceipt | null) => void;
}) {
  const choose = async (source: "camera" | "library") => {
    const picked = await pickReceipt(source);
    if (picked) {
      onChange(picked);
    } else if (source === "camera") {
      // null heißt hier entweder abgebrochen oder keine Kamera-Berechtigung
      Alert.alert(
        "Kein Foto",
        "Falls die Kamera gesperrt ist: in den Einstellungen den Kamerazugriff für Gemeinsam Wohnen erlauben."
      );
    }
  };

  return (
    <View style={styles.block}>
      <SectionTitle>Beleg</SectionTitle>
      {value ? (
        <View style={styles.previewRow}>
          <Image source={{ uri: value.uri }} style={styles.thumbnail} />
          <Text style={styles.previewText}>Foto angehängt</Text>
          <TouchableOpacity onPress={() => onChange(null)} style={styles.remove}>
            <Ionicons name="close-circle" size={22} color={colors.subtext} />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.buttons}>
          {cameraAvailable && (
            <TouchableOpacity style={styles.button} onPress={() => choose("camera")}>
              <Ionicons name="camera-outline" size={18} color={colors.primary} />
              <Text style={styles.buttonText}>Foto aufnehmen</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.button} onPress={() => choose("library")}>
            <Ionicons name="image-outline" size={18} color={colors.primary} />
            <Text style={styles.buttonText}>{cameraAvailable ? "Aus Galerie" : "Bild wählen"}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  buttons: { flexDirection: "row", gap: 8 },
  button: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  buttonText: { fontSize: 14, fontWeight: "600", color: colors.primary },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  thumbnail: { width: 48, height: 48, borderRadius: 6, backgroundColor: colors.background },
  previewText: { flex: 1, fontSize: 14, color: colors.text },
  remove: { padding: 4 },
});
