import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Modal,
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
import type { Task, TaskOccurrence } from "../../src/types/database";

type OccurrenceWithTask = TaskOccurrence & { tasks: Pick<Task, "title" | "points" | "interval_days"> };

export default function TasksScreen() {
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);
  const [occurrences, setOccurrences] = useState<OccurrenceWithTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [title, setTitle] = useState("");
  const [points, setPoints] = useState("1");
  const [intervalDays, setIntervalDays] = useState("7");

  const load = useCallback(async () => {
    if (!activeHousehold) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("task_occurrences")
      .select("*, tasks(title, points, interval_days)")
      .eq("household_id", activeHousehold.id)
      .eq("status", "open")
      .order("due_date", { ascending: true });

    if (error) console.error(error);
    setOccurrences((data as OccurrenceWithTask[]) ?? []);
    setLoading(false);
  }, [activeHousehold]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const nameFor = (userId: string | null) =>
    members.find((m) => m.id === userId)?.full_name ?? "Niemand";

  const markDone = async (occurrence: OccurrenceWithTask) => {
    if (!session) return;

    await supabase
      .from("task_occurrences")
      .update({
        status: "done",
        completed_by: session.user.id,
        completed_at: new Date().toISOString(),
      })
      .eq("id", occurrence.id);

    const nextDue = new Date(occurrence.due_date);
    nextDue.setDate(nextDue.getDate() + occurrence.tasks.interval_days);

    await supabase.from("task_occurrences").insert({
      task_id: occurrence.task_id,
      household_id: occurrence.household_id,
      due_date: nextDue.toISOString().slice(0, 10),
    });

    load();
  };

  const createTask = async () => {
    if (!session || !activeHousehold || !title.trim()) return;

    const { data: task, error } = await supabase
      .from("tasks")
      .insert({
        household_id: activeHousehold.id,
        title: title.trim(),
        points: Number(points) || 1,
        interval_days: Number(intervalDays) || 7,
        created_by: session.user.id,
      })
      .select()
      .single();

    if (error || !task) {
      console.error(error);
      return;
    }

    await supabase.from("task_occurrences").insert({
      task_id: task.id,
      household_id: activeHousehold.id,
      due_date: new Date().toISOString().slice(0, 10),
    });

    setTitle("");
    setPoints("1");
    setIntervalDays("7");
    setModalVisible(false);
    load();
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={occurrences}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListEmptyComponent={<Text style={styles.empty}>Keine offenen Aufgaben. 🎉</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{item.tasks.title}</Text>
              <Text style={styles.cardSubtitle}>
                Fällig: {item.due_date} · {item.tasks.points} Pkt
                {item.assigned_to ? ` · ${nameFor(item.assigned_to)}` : ""}
              </Text>
            </View>
            <TouchableOpacity style={styles.doneButton} onPress={() => markDone(item)}>
              <Text style={styles.doneButtonText}>Erledigt</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      <TouchableOpacity style={styles.fab} onPress={() => setModalVisible(true)}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Neue Aufgabe</Text>
            <TextInput
              style={styles.input}
              placeholder="Titel (z.B. Küche putzen)"
              value={title}
              onChangeText={setTitle}
            />
            <TextInput
              style={styles.input}
              placeholder="Punkte"
              value={points}
              onChangeText={setPoints}
              keyboardType="number-pad"
            />
            <TextInput
              style={styles.input}
              placeholder="Intervall in Tagen"
              value={intervalDays}
              onChangeText={setIntervalDays}
              keyboardType="number-pad"
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.border }]}
                onPress={() => setModalVisible(false)}
              >
                <Text style={[styles.modalButtonText, { color: colors.text }]}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalButton} onPress={createTask}>
                <Text style={styles.modalButtonText}>Erstellen</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  empty: { textAlign: "center", color: colors.subtext, marginTop: 40 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderColor: colors.border,
    borderWidth: 1,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  cardTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  cardSubtitle: { fontSize: 13, color: colors.subtext, marginTop: 2 },
  doneButton: {
    backgroundColor: colors.success,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  doneButtonText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    backgroundColor: colors.primary,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    elevation: 4,
  },
  fabText: { color: "#fff", fontSize: 28, lineHeight: 28 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: { backgroundColor: colors.card, borderRadius: 14, padding: 20, gap: 10 },
  modalTitle: { fontSize: 18, fontWeight: "700", color: colors.text, marginBottom: 6 },
  input: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  modalButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  modalButtonText: { color: "#fff", fontWeight: "600" },
});
