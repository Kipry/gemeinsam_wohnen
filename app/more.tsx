import { router } from "expo-router";
import { Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../src/lib/supabase";
import { useAuth } from "../src/lib/AuthProvider";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { useHouseholdMembers } from "../src/lib/useHouseholdMembers";
import { usePlaceholders } from "../src/lib/usePlaceholders";
import { makeStyles, useColors } from "../src/lib/theme";
import { formatCents } from "../src/lib/money";
import { signOutToLogin } from "../src/lib/signOut";
import { legalLinks } from "../src/lib/links";
import { Button, Card, SectionTitle } from "../src/components/ui";

const LINKS = [
  { href: "/review", icon: "bar-chart", title: "Rückblick" },
  { href: "/recurring", icon: "repeat", title: "Feste Kosten" },
  { href: "/waste", icon: "trash", title: "Müllabfuhr" },
  { href: "/teams", icon: "people", title: "Teams" },
  { href: "/notifications", icon: "notifications", title: "Mitteilungen" },
] as const;

export default function MoreScreen() {
  const legal = legalLinks;
  const styles = useStyles();
  const colors = useColors();
  const { session } = useAuth();
  const { activeHousehold, households, setActiveHousehold, refresh } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);
  const { placeholders } = usePlaceholders(activeHousehold?.id);
  const myName = members.find((member) => member.id === session?.user.id)?.full_name;

  const leaveHousehold = async () => {
    if (!activeHousehold || !session) return;
    const household = activeHousehold;

    const { data } = await supabase
      .from("expense_balance_view")
      .select("net_cents")
      .eq("household_id", household.id)
      .eq("user_id", session.user.id)
      .limit(1);
    const net = data?.[0]?.net_cents ?? 0;
    const balanceHint =
      net > 0
        ? `\n\nDu bekommst noch ${formatCents(net)} — am besten vorher ausgleichen.`
        : net < 0
          ? `\n\nDu schuldest noch ${formatCents(-net)} — am besten vorher ausgleichen.`
          : "";

    Alert.alert(
      `„${household.name}" verlassen?`,
      `Deine Putz-Plätze werden unter den anderen neu verteilt. Ausgaben bleiben für alle sichtbar.${balanceHint}`,
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Verlassen",
          style: "destructive",
          onPress: async () => {
            const { error } = await supabase.rpc("leave_household", { p_household_id: household.id });
            if (error) {
              Alert.alert("Fehler", error.message);
              return;
            }
            await refresh();
            router.back();
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => router.push("/edit-name")}>
        <Card style={styles.linkCard}>
          <Ionicons name="person-circle" size={22} color={colors.tint} />
          <View style={{ flex: 1 }}>
            <Text style={styles.linkTitle}>Dein Name</Text>
            <Text style={styles.muted}>{myName ?? "…"}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
        </Card>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.push("/invite")}>
        <Card>
          <Text style={styles.householdName}>{activeHousehold?.name}</Text>
          <Text style={styles.muted}>
            {members.length} {members.length === 1 ? "Mitglied" : "Mitglieder"}
            {placeholders.length > 0 ? ` · ${placeholders.length} noch nicht dabei` : ""}
          </Text>
          <Text style={styles.codeLabel}>Einladungscode</Text>
          <Text style={styles.code}>{activeHousehold?.invite_code}</Text>
          <View style={styles.inviteRow}>
            <Ionicons name="share-outline" size={16} color={colors.tint} />
            <Text style={styles.inviteText}>Mitbewohner einladen oder vormerken</Text>
          </View>
        </Card>
      </TouchableOpacity>

      <Card style={styles.linkGroup}>
        {LINKS.map((link, index) => (
          <TouchableOpacity
            key={link.href}
            style={[styles.linkRow, index > 0 && styles.linkRowDivider]}
            onPress={() => router.push(link.href)}
          >
            <Ionicons name={link.icon} size={20} color={colors.tint} />
            <Text style={[styles.linkTitle, { flex: 1 }]}>{link.title}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
          </TouchableOpacity>
        ))}
      </Card>

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
      {members.length > 1 && (
        <Button title={`„${activeHousehold?.name}" verlassen`} variant="secondary" onPress={leaveHousehold} />
      )}
      <Button title="Abmelden" variant="danger" onPress={() => signOutToLogin()} />

      <TouchableOpacity style={styles.deleteAccount} onPress={() => router.push("/delete-account")}>
        <Text style={styles.deleteAccountText}>Konto löschen</Text>
      </TouchableOpacity>

      {legal && (
        <View style={styles.legalRow}>
          <Text style={styles.legalLink} onPress={() => Linking.openURL(legal.privacy)}>
            Datenschutz
          </Text>
          <Text style={styles.legalLink} onPress={() => Linking.openURL(legal.imprint)}>
            Impressum
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  householdName: { fontSize: 20, fontWeight: "700", color: colors.text },
  muted: { fontSize: 13, color: colors.subtext },
  codeLabel: { fontSize: 12, color: colors.subtext, marginTop: 8 },
  code: { fontSize: 26, fontWeight: "700", color: colors.tint, letterSpacing: 3 },
  inviteRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  inviteText: { fontSize: 13, color: colors.tint, fontWeight: "600" },
  linkCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  linkTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  householdRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  active: { color: colors.tint, fontWeight: "600" },
  legalRow: { flexDirection: "row", justifyContent: "center", gap: 20, marginTop: 4 },
  legalLink: { fontSize: 13, color: colors.subtext, textDecorationLine: "underline" },
  deleteAccount: { alignSelf: "center", paddingVertical: 10, paddingHorizontal: 16 },
  deleteAccountText: { fontSize: 14, color: colors.subtext, textDecorationLine: "underline" },
  linkGroup: { paddingVertical: 0, gap: 0 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13 },
  linkRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
}));
