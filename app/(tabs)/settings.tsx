import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { supabase } from "../../src/lib/supabase";
import { useHousehold } from "../../src/lib/HouseholdProvider";
import { colors } from "../../src/lib/theme";

export default function SettingsScreen() {
  const { activeHousehold, households, setActiveHousehold } = useHousehold();

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.label}>Aktuelle WG</Text>
        <Text style={styles.value}>{activeHousehold?.name}</Text>
        <Text style={styles.label}>Einladungscode</Text>
        <Text style={styles.code}>{activeHousehold?.invite_code}</Text>
        <Text style={styles.hint}>Teile diesen Code mit neuen Mitbewohnern.</Text>
      </View>

      {households.length > 1 && (
        <View style={styles.card}>
          <Text style={styles.label}>WG wechseln</Text>
          {households.map((h) => (
            <TouchableOpacity key={h.id} style={styles.householdRow} onPress={() => setActiveHousehold(h)}>
              <Text style={styles.value}>{h.name}</Text>
              {h.id === activeHousehold?.id && <Text style={styles.active}>aktiv</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}

      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push("/(auth)/household")}
      >
        <Text style={styles.value}>+ Weitere WG erstellen / beitreten</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
        <Text style={styles.signOutText}>Abmelden</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 16 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderColor: colors.border,
    borderWidth: 1,
    padding: 16,
    gap: 4,
  },
  label: { fontSize: 12, color: colors.subtext, marginTop: 8 },
  value: { fontSize: 16, color: colors.text, fontWeight: "600" },
  code: { fontSize: 24, color: colors.primary, fontWeight: "700", letterSpacing: 2 },
  hint: { fontSize: 12, color: colors.subtext },
  householdRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: 4,
  },
  active: { color: colors.primary, fontWeight: "600" },
  signOutButton: {
    backgroundColor: colors.danger,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: "auto",
  },
  signOutText: { color: "#fff", fontWeight: "600", fontSize: 15 },
});
