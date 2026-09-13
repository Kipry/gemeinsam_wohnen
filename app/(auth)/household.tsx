import { useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Redirect } from "expo-router";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/lib/AuthProvider";
import { useHousehold } from "../../src/lib/HouseholdProvider";
import { colors } from "../../src/lib/theme";
import type { Household } from "../../src/types/database";

export default function HouseholdSetup() {
  const { session } = useAuth();
  const { activeHousehold, refresh, setActiveHousehold } = useHousehold();
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (activeHousehold) {
    return <Redirect href="/" />;
  }

  const createHousehold = async () => {
    if (!session || !name.trim()) return;
    setError(null);
    setLoading(true);

    const { data, error: createError } = await supabase.rpc("create_household", {
      name: name.trim(),
    });

    setLoading(false);
    if (createError || !data) {
      setError(createError?.message ?? "Konnte WG nicht erstellen");
      return;
    }

    await refresh();
    setActiveHousehold(data as Household);
  };

  const joinHousehold = async () => {
    if (!session || !inviteCode.trim()) return;
    setError(null);
    setLoading(true);

    const { data, error: joinError } = await supabase.rpc("join_household_by_code", {
      code: inviteCode.trim(),
    });

    setLoading(false);
    if (joinError || !data) {
      setError(joinError?.message ?? "Einladungscode nicht gefunden");
      return;
    }

    await refresh();
    setActiveHousehold(data as Household);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>WG einrichten</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Neue WG erstellen</Text>
        <TextInput
          style={styles.input}
          placeholder="Name der WG"
          value={name}
          onChangeText={setName}
        />
        <TouchableOpacity style={styles.button} onPress={createHousehold} disabled={loading}>
          <Text style={styles.buttonText}>WG erstellen</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.or}>oder</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Bestehender WG beitreten</Text>
        <TextInput
          style={styles.input}
          placeholder="Einladungscode"
          value={inviteCode}
          onChangeText={setInviteCode}
          autoCapitalize="none"
        />
        <TouchableOpacity style={styles.button} onPress={joinHousehold} disabled={loading}>
          <Text style={styles.buttonText}>Beitreten</Text>
        </TouchableOpacity>
      </View>

      {loading && <ActivityIndicator style={{ marginTop: 8 }} />}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: colors.background, gap: 16 },
  title: { fontSize: 24, fontWeight: "700", color: colors.text, marginBottom: 8 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderColor: colors.border,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  cardTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  input: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonText: { color: colors.primaryText, fontSize: 15, fontWeight: "600" },
  or: { textAlign: "center", color: colors.subtext },
  error: { color: colors.danger, textAlign: "center" },
});
