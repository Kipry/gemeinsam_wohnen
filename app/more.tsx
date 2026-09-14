import { useState } from "react";
import { router } from "expo-router";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../src/lib/supabase";
import { useAuth } from "../src/lib/AuthProvider";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { useHouseholdMembers } from "../src/lib/useHouseholdMembers";
import { usePlaceholders } from "../src/lib/usePlaceholders";
import { colors } from "../src/lib/theme";
import { Button, Card, Input, SectionTitle } from "../src/components/ui";

const LINKS = [
  {
    href: "/review",
    icon: "bar-chart",
    title: "Monatsrückblick",
    subtitle: "Kosten und Putzen im Monat",
  },
  { href: "/stats", icon: "stats-chart", title: "Statistik", subtitle: "Wer hat wie viel gemacht" },
  {
    href: "/recurring",
    icon: "repeat",
    title: "Feste Kosten",
    subtitle: "Miete, Strom, Streaming",
  },
  { href: "/teams", icon: "people", title: "Teams", subtitle: "Putz-Teams verwalten" },
] as const;

export default function MoreScreen() {
  const { session } = useAuth();
  const { activeHousehold, households, setActiveHousehold } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);
  const { placeholders, refresh: refreshPlaceholders } = usePlaceholders(activeHousehold?.id);
  const [newName, setNewName] = useState("");

  const addPlaceholder = async () => {
    if (!activeHousehold || !session || !newName.trim()) return;
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => router.push("/invite")}>
        <Card>
          <Text style={styles.householdName}>{activeHousehold?.name}</Text>
          <Text style={styles.muted}>
            {members.length} {members.length === 1 ? "Mitglied" : "Mitglieder"}
          </Text>
          <Text style={styles.codeLabel}>Einladungscode</Text>
          <Text style={styles.code}>{activeHousehold?.invite_code}</Text>
          <View style={styles.inviteRow}>
            <Ionicons name="share-outline" size={16} color={colors.primary} />
            <Text style={styles.inviteText}>Mitbewohner einladen — Link oder QR-Code</Text>
          </View>
        </Card>
      </TouchableOpacity>

      <Card>
        <Text style={styles.linkTitle}>Noch nicht beigetreten</Text>
        <Text style={styles.muted}>
          Vorgemerkte Mitbewohner stehen schon im Putzplan. Beim Beitritt wählen sie ihren Namen und
          übernehmen den Platz.
        </Text>
        {placeholders.length > 0 && (
          <View style={styles.placeholderWrap}>
            {placeholders.map((placeholder) => (
              <TouchableOpacity
                key={placeholder.id}
                style={styles.placeholderChip}
                onPress={() => removePlaceholder(placeholder.id, placeholder.name)}
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
          <TouchableOpacity style={styles.addButton} onPress={addPlaceholder}>
            <Ionicons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </Card>

      {LINKS.map((link) => (
        <TouchableOpacity key={link.href} onPress={() => router.push(link.href)}>
          <Card style={styles.linkCard}>
            <Ionicons name={link.icon} size={22} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>{link.title}</Text>
              <Text style={styles.muted}>{link.subtitle}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
          </Card>
        </TouchableOpacity>
      ))}

      {households.length > 1 && (
        <>
          <SectionTitle>WG wechseln</SectionTitle>
          <Card style={{ gap: 0 }}>
            {households.map((h) => (
              <TouchableOpacity
                key={h.id}
                style={styles.householdRow}
                onPress={() => setActiveHousehold(h)}
              >
                <Text style={styles.linkTitle}>{h.name}</Text>
                {h.id === activeHousehold?.id && <Text style={styles.active}>aktiv</Text>}
              </TouchableOpacity>
            ))}
          </Card>
        </>
      )}

      <Button
        title="Weitere WG erstellen / beitreten"
        variant="secondary"
        onPress={() => router.push("/(auth)/household")}
      />
      <Button title="Abmelden" variant="danger" onPress={() => supabase.auth.signOut()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  householdName: { fontSize: 20, fontWeight: "700", color: colors.text },
  muted: { fontSize: 13, color: colors.subtext },
  codeLabel: { fontSize: 12, color: colors.subtext, marginTop: 8 },
  code: { fontSize: 26, fontWeight: "700", color: colors.primary, letterSpacing: 3 },
  inviteRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  inviteText: { fontSize: 13, color: colors.primary, fontWeight: "600" },
  linkCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  linkTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  householdRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  active: { color: colors.primary, fontWeight: "600" },
  placeholderWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
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
  addRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 10 },
  addButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
});
