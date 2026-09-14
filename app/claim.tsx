import { useState } from "react";
import { Redirect, router } from "expo-router";
import { ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../src/lib/supabase";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { usePlaceholders } from "../src/lib/usePlaceholders";
import { makeStyles, useColors } from "../src/lib/theme";
import { ErrorText, Loading, Muted } from "../src/components/ui";

/**
 * Nach dem Beitritt: Hat der Gründer schon Platzhalter angelegt, übernimmt
 * man hier seinen Platz — samt Rotation und bereits geplanten Terminen.
 */
export default function ClaimScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { activeHousehold } = useHousehold();
  const { placeholders, loading } = usePlaceholders(activeHousehold?.id);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (loading || !activeHousehold) return <Loading />;

  const done = () => router.replace("/(tabs)/tasks");

  // Keine offenen Plätze (mehr) — nichts zu wählen
  if (placeholders.length === 0) {
    return <Redirect href="/(tabs)/tasks" />;
  }

  const claim = async (placeholderId: string) => {
    setBusyId(placeholderId);
    setError(null);
    const { error: claimError } = await supabase.rpc("claim_placeholder", {
      p_placeholder_id: placeholderId,
    });
    setBusyId(null);

    if (claimError) {
      setError(claimError.message);
      return;
    }
    done();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Wer bist du?</Text>
      <Muted>
        In {activeHousehold.name} ist schon ein Platz für dich vorbereitet. Wähl deinen Namen —
        du übernimmst damit auch die Aufgaben, die dafür schon geplant sind.
      </Muted>

      {placeholders.map((placeholder) => (
        <TouchableOpacity
          key={placeholder.id}
          style={styles.option}
          onPress={() => claim(placeholder.id)}
          disabled={busyId !== null}
        >
          <Ionicons name="person-circle" size={28} color={colors.tint} />
          <Text style={styles.optionText}>Ich bin {placeholder.name}</Text>
          {busyId === placeholder.id ? (
            <Text style={styles.busy}>…</Text>
          ) : (
            <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
          )}
        </TouchableOpacity>
      ))}

      <TouchableOpacity style={[styles.option, styles.optionNew]} onPress={done}>
        <Ionicons name="person-add-outline" size={24} color={colors.subtext} />
        <Text style={[styles.optionText, { color: colors.subtext }]}>Keiner davon — ich bin neu</Text>
      </TouchableOpacity>

      {error && <ErrorText>{error}</ErrorText>}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, gap: 12, paddingTop: 56 },
  title: { fontSize: 26, fontWeight: "700", color: colors.text },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  optionNew: { backgroundColor: "transparent", borderStyle: "dashed" },
  optionText: { flex: 1, fontSize: 16, fontWeight: "600", color: colors.text },
  busy: { fontSize: 16, color: colors.subtext },
}));
