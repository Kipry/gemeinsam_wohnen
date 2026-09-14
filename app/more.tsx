import { router } from "expo-router";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../src/lib/supabase";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { useHouseholdMembers } from "../src/lib/useHouseholdMembers";
import { colors } from "../src/lib/theme";
import { Button, Card, SectionTitle } from "../src/components/ui";

const LINKS = [
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
  const { activeHousehold, households, setActiveHousehold } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);

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
});
