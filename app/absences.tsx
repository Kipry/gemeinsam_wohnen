import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Alert, FlatList, StyleSheet, View } from "react-native";
import { supabase } from "../src/lib/supabase";
import { useAuth } from "../src/lib/AuthProvider";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { useHouseholdMembers } from "../src/lib/useHouseholdMembers";
import { colors } from "../src/lib/theme";
import { Button, Empty, Input, Muted, Row, Screen, SectionTitle } from "../src/components/ui";
import type { Absence } from "../src/types/database";

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function AbsencesScreen() {
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!activeHousehold) return;
    const { data, error } = await supabase
      .from("absences")
      .select("*")
      .eq("household_id", activeHousehold.id)
      .gte("end_date", todayISO())
      .order("start_date");

    if (error) console.error(error);
    setAbsences(data ?? []);
  }, [activeHousehold]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const add = async () => {
    if (!session || !activeHousehold) return;
    if (endDate < startDate) {
      Alert.alert("Ungültiger Zeitraum", "Das Enddatum liegt vor dem Startdatum.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("absences").insert({
      household_id: activeHousehold.id,
      user_id: session.user.id,
      start_date: startDate,
      end_date: endDate,
      note: note.trim() || null,
    });
    setSaving(false);

    if (error) {
      Alert.alert("Fehler", error.message);
      return;
    }
    setNote("");
    load();
  };

  const remove = (absence: Absence) => {
    if (absence.user_id !== session?.user.id) return;
    Alert.alert("Abwesenheit löschen", "Eintrag entfernen?", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Löschen",
        style: "destructive",
        onPress: async () => {
          await supabase.from("absences").delete().eq("id", absence.id);
          load();
        },
      },
    ]);
  };

  return (
    <Screen>
      <View style={styles.form}>
        <SectionTitle>Abwesenheit melden</SectionTitle>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Input
            style={{ flex: 1 }}
            placeholder="Von (JJJJ-MM-TT)"
            value={startDate}
            onChangeText={setStartDate}
          />
          <Input
            style={{ flex: 1 }}
            placeholder="Bis (JJJJ-MM-TT)"
            value={endDate}
            onChangeText={setEndDate}
          />
        </View>
        <Input placeholder="Notiz (optional)" value={note} onChangeText={setNote} />
        <Button title="Melden" onPress={add} loading={saving} />
        <Muted>
          In Putzplan-Rotationen werden abwesende Personen automatisch übersprungen.
        </Muted>
      </View>

      <FlatList
        data={absences}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        ListEmptyComponent={<Empty>Aktuell ist niemand abwesend gemeldet.</Empty>}
        renderItem={({ item }) => (
          <Row
            title={
              item.user_id === session?.user.id
                ? "Du"
                : members.find((m) => m.id === item.user_id)?.full_name ?? "?"
            }
            subtitle={`${item.start_date} – ${item.end_date}${item.note ? ` · ${item.note}` : ""}`}
            onLongPress={() => remove(item)}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: {
    padding: 16,
    gap: 8,
    backgroundColor: colors.card,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
});
