import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/lib/AuthProvider";
import { useHousehold } from "../../src/lib/HouseholdProvider";
import { useHouseholdMembers } from "../../src/lib/useHouseholdMembers";
import { colors } from "../../src/lib/theme";
import type { Absence } from "../../src/types/database";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function AbsencesScreen() {
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    if (!activeHousehold) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("absences")
      .select("*")
      .eq("household_id", activeHousehold.id)
      .gte("end_date", todayISO())
      .order("start_date", { ascending: true });

    if (error) console.error(error);
    setAbsences(data ?? []);
    setLoading(false);
  }, [activeHousehold]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const nameFor = (userId: string) => members.find((m) => m.id === userId)?.full_name ?? "?";

  const addAbsence = async () => {
    if (!session || !activeHousehold) return;
    await supabase.from("absences").insert({
      household_id: activeHousehold.id,
      user_id: session.user.id,
      start_date: startDate,
      end_date: endDate,
      note: note.trim() || null,
    });
    setNote("");
    load();
  };

  const removeAbsence = async (absence: Absence) => {
    await supabase.from("absences").delete().eq("id", absence.id);
    load();
  };

  return (
    <View style={styles.container}>
      <View style={styles.form}>
        <Text style={styles.formTitle}>Abwesenheit melden</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Von (JJJJ-MM-TT)"
            value={startDate}
            onChangeText={setStartDate}
          />
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Bis (JJJJ-MM-TT)"
            value={endDate}
            onChangeText={setEndDate}
          />
        </View>
        <TextInput
          style={styles.input}
          placeholder="Notiz (optional)"
          value={note}
          onChangeText={setNote}
        />
        <TouchableOpacity style={styles.button} onPress={addAbsence}>
          <Text style={styles.buttonText}>Melden</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 20 }} />
      ) : (
        <FlatList
          data={absences}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          ListEmptyComponent={<Text style={styles.empty}>Aktuell ist niemand als abwesend gemeldet.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onLongPress={() => removeAbsence(item)}>
              <Text style={styles.rowTitle}>{nameFor(item.user_id)}</Text>
              <Text style={styles.rowSubtitle}>
                {item.start_date} – {item.end_date}
                {item.note ? ` · ${item.note}` : ""}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  form: { padding: 16, gap: 8, backgroundColor: colors.card, borderBottomColor: colors.border, borderBottomWidth: 1 },
  formTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  input: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontWeight: "600" },
  empty: { textAlign: "center", color: colors.subtext, marginTop: 20 },
  row: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1,
    padding: 14,
  },
  rowTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  rowSubtitle: { fontSize: 13, color: colors.subtext, marginTop: 2 },
});
