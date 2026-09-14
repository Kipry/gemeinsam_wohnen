import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../lib/theme";
import {
  attachReceipt,
  cameraAvailable,
  detachReceipt,
  pickReceipt,
  receiptUrl,
} from "../lib/receipts";
import { Card } from "./ui";

/** Beleg einer bestehenden Ausgabe: ansehen, groß zeigen, nachreichen, ersetzen, entfernen. */
export function ReceiptSection({
  expenseId,
  householdId,
  path,
  onChanged,
}: {
  expenseId: string;
  householdId: string;
  path: string | null;
  onChanged: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    let active = true;
    setUrl(null);
    if (path) {
      receiptUrl(path).then((signed) => {
        if (active) setUrl(signed);
      });
    }
    return () => {
      active = false;
    };
  }, [path]);

  const upload = async (source: "camera" | "library") => {
    const picked = await pickReceipt(source);
    if (!picked) return;

    setBusy(true);
    try {
      await attachReceipt(householdId, expenseId, picked, path);
      onChanged();
    } catch (error: any) {
      Alert.alert("Beleg nicht hochgeladen", error?.message ?? "Unbekannter Fehler");
    } finally {
      setBusy(false);
    }
  };

  const chooseSource = () => {
    if (!cameraAvailable) {
      upload("library");
      return;
    }
    Alert.alert(path ? "Beleg ersetzen" : "Beleg hinzufügen", undefined, [
      { text: "Foto aufnehmen", onPress: () => upload("camera") },
      { text: "Aus Galerie", onPress: () => upload("library") },
      { text: "Abbrechen", style: "cancel" },
    ]);
  };

  const remove = () => {
    if (!path) return;
    Alert.alert("Beleg entfernen", "Das Foto wird gelöscht, die Ausgabe bleibt.", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Entfernen",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await detachReceipt(expenseId, path);
            onChanged();
          } catch (error: any) {
            Alert.alert("Fehler", error?.message ?? "Unbekannter Fehler");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <Card>
      <Text style={styles.title}>Beleg</Text>

      {busy ? (
        <ActivityIndicator style={{ marginVertical: 12 }} />
      ) : path ? (
        <>
          <TouchableOpacity onPress={() => url && setFullscreen(true)} disabled={!url}>
            {url ? (
              // contain statt cover: bei Kassenbons stehen Laden und Summe oben und unten
              <Image source={{ uri: url }} style={styles.preview} resizeMode="contain" />
            ) : (
              <View style={[styles.preview, styles.previewLoading]}>
                <ActivityIndicator />
              </View>
            )}
          </TouchableOpacity>
          <View style={styles.actions}>
            <TouchableOpacity onPress={chooseSource} style={styles.action}>
              <Ionicons name="swap-horizontal" size={16} color={colors.primary} />
              <Text style={styles.actionText}>Ersetzen</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={remove} style={styles.action}>
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
              <Text style={[styles.actionText, { color: colors.danger }]}>Entfernen</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <TouchableOpacity onPress={chooseSource} style={styles.empty}>
          <Ionicons name="receipt-outline" size={20} color={colors.primary} />
          <Text style={styles.actionText}>Foto vom Kassenbon hinzufügen</Text>
        </TouchableOpacity>
      )}

      <Modal visible={fullscreen} transparent animationType="fade" onRequestClose={() => setFullscreen(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setFullscreen(false)}>
          {url && <Image source={{ uri: url }} style={styles.full} resizeMode="contain" />}
          <View style={styles.closeHint}>
            <Ionicons name="close" size={22} color="#fff" />
          </View>
        </TouchableOpacity>
      </Modal>
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 13, fontWeight: "700", color: colors.subtext, textTransform: "uppercase" },
  preview: { width: "100%", height: 200, borderRadius: 8, backgroundColor: colors.background },
  previewLoading: { justifyContent: "center", alignItems: "center" },
  actions: { flexDirection: "row", gap: 16, marginTop: 4 },
  action: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
  actionText: { fontSize: 14, fontWeight: "600", color: colors.primary },
  empty: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    justifyContent: "center",
    alignItems: "center",
  },
  full: { width: "100%", height: "85%" },
  closeHint: { position: "absolute", top: 50, right: 20 },
});
