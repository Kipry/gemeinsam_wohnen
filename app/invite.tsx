import { useState } from "react";
import { Alert, ScrollView, Share, Text, TouchableOpacity, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../src/lib/supabase";
import { useAuth } from "../src/lib/AuthProvider";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { usePlaceholders } from "../src/lib/usePlaceholders";
import { makeStyles, useColors } from "../src/lib/theme";
import { inviteUrl } from "../src/lib/links";
import { Button, Card, Input, Loading, Muted } from "../src/components/ui";

/** Einladen und Mitbewohner vormerken, die noch nicht in der App sind */
export default function InviteScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { placeholders, refresh: refreshPlaceholders } = usePlaceholders(activeHousehold?.id);
  const [newName, setNewName] = useState("");

  if (!activeHousehold) return <Loading />;

  const link = inviteUrl(activeHousehold.invite_code);

  const share = async () => {
    await Share.share({
      message:
        `Komm in unsere WG „${activeHousehold.name}" bei Gemeinsam Wohnen!\n\n` +
        `${link}\n\n` +
        `Falls der Link nicht geht: Code ${activeHousehold.invite_code} in der App eingeben.`,
    });
  };

  const addPlaceholder = async () => {
    if (!session || !newName.trim()) return;
    const { error } = await supabase.from("household_placeholders").insert({
      household_id: activeHousehold.id,
      name: newName.trim(),
      created_by: session.user.id,
    });
    if (error) {
      Alert.alert("Fehler", error.message);
      return;
    }
    setNewName("");
    refreshPlaceholders();
  };

  const removePlaceholder = (id: string, name: string) => {
    Alert.alert(
      `${name} entfernen?`,
      "Der Platz verschwindet aus allen Rotationen, offene Termine werden neu verteilt.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Entfernen",
          style: "destructive",
          onPress: async () => {
            const { error } = await supabase.rpc("remove_placeholder", { p_placeholder_id: id });
            if (error) Alert.alert("Fehler", error.message);
            refreshPlaceholders();
          },
        },
      ]
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <Card style={styles.qrCard}>
        <QRCode value={link} size={200} backgroundColor={colors.card} color={colors.text} />
        <Text style={styles.code}>{activeHousehold.invite_code}</Text>
        <Muted>Abfotografieren oder Code eintippen</Muted>
      </Card>

      <Button title="Einladung teilen" onPress={share} />
      <Muted>
        Der Link führt auf eine Seite mit dem Code: Von dort öffnet sich die App mit ausgefülltem
        Code, und wer sie noch nicht hat, findet den Weg zur Installation.
      </Muted>

      <Card>
        <Text style={styles.sectionTitle}>Noch nicht dabei</Text>
        <Muted>Stehen schon im Putzplan und übernehmen beim Beitritt ihren Platz.</Muted>
        {placeholders.length > 0 && (
          <View style={styles.placeholderWrap}>
            {placeholders.map((placeholder) => (
              <TouchableOpacity
                key={placeholder.id}
                style={styles.placeholderChip}
                onPress={() => removePlaceholder(placeholder.id, placeholder.name)}
                accessibilityLabel={`${placeholder.name} entfernen`}
              >
                <Text style={styles.placeholderText}>{placeholder.name}</Text>
                <Ionicons name="close" size={14} color={colors.subtext} />
              </TouchableOpacity>
            ))}
          </View>
        )}
        <View style={styles.addRow}>
          <Input
            style={{ flex: 1, paddingVertical: 8 }}
            placeholder="Name vormerken"
            value={newName}
            onChangeText={setNewName}
            onSubmitEditing={addPlaceholder}
          />
          <TouchableOpacity style={styles.addButton} onPress={addPlaceholder} accessibilityLabel="Vormerken">
            <Ionicons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </Card>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  qrCard: { alignItems: "center", gap: 12, paddingVertical: 24 },
  code: { fontSize: 30, fontWeight: "700", color: colors.tint, letterSpacing: 4 },
  sectionTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  placeholderWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  placeholderChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  placeholderText: { fontSize: 14, color: colors.text },
  addRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 4 },
  addButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
}));
