import { useState } from "react";
import { router } from "expo-router";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../src/lib/supabase";
import { useAuth } from "../src/lib/AuthProvider";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { colors } from "../src/lib/theme";
import { addDays, todayISO } from "../src/lib/dates";
import { TEMPLATES } from "../src/components/TaskForm";
import { Button, ErrorText, Input, Loading, Muted } from "../src/components/ui";

const PRESELECTED = ["Müll rausbringen", "Bad putzen", "Küche putzen", "Staubsaugen"];

/** "Lisa", "Lisa und Tom", "Lisa, Tom und Max" */
function joinNames(names: string[]) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`;
}

function intervalLabel(days: number) {
  if (days === 1) return "jeden Tag";
  if (days === 7) return "jede Woche";
  if (days === 14) return "alle zwei Wochen";
  return `alle ${days} Tage`;
}

/**
 * Direkt nach dem Gründen der WG: statt vor einer leeren App zu sitzen,
 * stehen nach zwei Schritten Mitbewohner und Putzplan — auch wenn noch
 * niemand sonst beigetreten ist.
 */
export default function Onboarding() {
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");
  const [roommates, setRoommates] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>(PRESELECTED);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdCount, setCreatedCount] = useState(0);

  if (!session || !activeHousehold) return <Loading />;

  const addRoommate = () => {
    const value = name.trim();
    if (!value) return;
    if (roommates.some((entry) => entry.toLowerCase() === value.toLowerCase())) {
      setName("");
      return;
    }
    setRoommates((prev) => [...prev, value]);
    setName("");
  };

  const toggleTemplate = (title: string) => {
    setSelected((prev) => (prev.includes(title) ? prev.filter((x) => x !== title) : [...prev, title]));
  };

  const createPlan = async () => {
    setSaving(true);
    setError(null);

    const placeholderIds: string[] = [];
    for (const roommate of roommates) {
      const { data, error: insertError } = await supabase
        .from("household_placeholders")
        .insert({ household_id: activeHousehold.id, name: roommate, created_by: session.user.id })
        .select("id")
        .single();

      if (insertError || !data) {
        setSaving(false);
        setError(insertError?.message ?? "Mitbewohner konnten nicht angelegt werden");
        return;
      }
      placeholderIds.push(data.id);
    }

    const people = [
      { user_id: session.user.id },
      ...placeholderIds.map((id) => ({ placeholder_id: id })),
    ];

    const chosen = TEMPLATES.filter((template) => selected.includes(template.title));

    for (const [index, template] of chosen.entries()) {
      // Jede Aufgabe beginnt bei einer anderen Person und an einem anderen Tag —
      // sonst hätte der Gründer in der ersten Woche alles auf einmal.
      const offset = index % people.length;
      const rotation = [...people.slice(offset), ...people.slice(0, offset)];

      const { error: taskError } = await supabase.rpc("create_task", {
        p_household_id: activeHousehold.id,
        p_title: template.title,
        p_points: template.points,
        p_interval_days: template.interval_days,
        p_assignment_mode: "rotation_member",
        p_rotation: rotation,
        p_first_due: addDays(todayISO(), index),
      });

      if (taskError) {
        setSaving(false);
        setError(taskError.message);
        return;
      }
    }

    setCreatedCount(chosen.length);
    setSaving(false);
    setStep(3);
  };

  const finish = (invite: boolean) => {
    router.replace("/(tabs)/tasks");
    if (invite) router.push("/invite");
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.progress}>
        {[1, 2, 3].map((dot) => (
          <View key={dot} style={[styles.progressDot, dot <= step && styles.progressDotActive]} />
        ))}
      </View>

      {step === 1 && (
        <>
          <Text style={styles.title}>Wer wohnt mit dir?</Text>
          <Muted>
            Trag die Namen ein — die anderen müssen dafür noch nicht in der App sein. Sobald sie
            beitreten, übernehmen sie ihren Platz im Putzplan.
          </Muted>

          <View style={styles.addRow}>
            <Input
              style={{ flex: 1 }}
              placeholder="Name, z.B. Lisa"
              value={name}
              onChangeText={setName}
              onSubmitEditing={addRoommate}
              returnKeyType="next"
              blurOnSubmit={false}
            />
            <TouchableOpacity style={styles.addButton} onPress={addRoommate}>
              <Ionicons name="add" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={styles.chipWrap}>
            <View style={[styles.person, styles.personMe]}>
              <Text style={styles.personMeText}>Du</Text>
            </View>
            {roommates.map((roommate) => (
              <TouchableOpacity
                key={roommate}
                style={styles.person}
                onPress={() => setRoommates((prev) => prev.filter((x) => x !== roommate))}
              >
                <Text style={styles.personText}>{roommate}</Text>
                <Ionicons name="close" size={14} color={colors.subtext} />
              </TouchableOpacity>
            ))}
          </View>

          <Button title={roommates.length > 0 ? "Weiter" : "Ich wohne allein — weiter"} onPress={() => setStep(2)} />
        </>
      )}

      {step === 2 && (
        <>
          <Text style={styles.title}>Was muss regelmäßig gemacht werden?</Text>
          <Muted>
            {roommates.length > 0
              ? `Ihr wechselt euch ab: du, ${joinNames(roommates)}. Alles lässt sich später ändern.`
              : "Alles lässt sich später ändern und um weitere Aufgaben ergänzen."}
          </Muted>

          <View style={styles.list}>
            {TEMPLATES.map((template) => {
              const isOn = selected.includes(template.title);
              return (
                <TouchableOpacity
                  key={template.title}
                  style={styles.listRow}
                  onPress={() => toggleTemplate(template.title)}
                >
                  <Ionicons
                    name={isOn ? "checkbox" : "square-outline"}
                    size={22}
                    color={isOn ? colors.primary : colors.subtext}
                  />
                  <Text style={styles.listTitle}>{template.title}</Text>
                  <Text style={styles.listMeta}>{intervalLabel(template.interval_days)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {error && <ErrorText>{error}</ErrorText>}

          <Button
            title={selected.length > 0 ? `${selected.length} Aufgaben planen` : "Ohne Aufgaben weiter"}
            onPress={createPlan}
            loading={saving}
          />
          <Button title="Zurück" variant="secondary" onPress={() => setStep(1)} />
        </>
      )}

      {step === 3 && (
        <>
          <Ionicons name="checkmark-circle" size={56} color={colors.success} style={{ alignSelf: "center" }} />
          <Text style={[styles.title, { textAlign: "center" }]}>Eure WG steht</Text>
          <Muted>
            {createdCount > 0
              ? `${createdCount} Aufgaben sind für die nächsten vier Wochen verteilt.`
              : "Aufgaben kannst du jederzeit im Putzplan anlegen."}
            {roommates.length > 0
              ? ` ${joinNames(roommates)} ${roommates.length === 1 ? "steht" : "stehen"} schon drin — jetzt fehlt nur noch der Einladungslink.`
              : ""}
          </Muted>
          <Button title="Mitbewohner einladen" onPress={() => finish(true)} />
          <Button title="Später" variant="secondary" onPress={() => finish(false)} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, gap: 14, paddingTop: 48, paddingBottom: 48 },
  progress: { flexDirection: "row", gap: 6, justifyContent: "center", marginBottom: 8 },
  progressDot: { width: 28, height: 4, borderRadius: 2, backgroundColor: colors.border },
  progressDotActive: { backgroundColor: colors.primary },
  title: { fontSize: 24, fontWeight: "700", color: colors.text },
  addRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  addButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    width: 48,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  personMe: { backgroundColor: colors.primary, borderColor: colors.primary },
  personText: { fontSize: 14, color: colors.text },
  personMeText: { fontSize: 14, color: "#fff", fontWeight: "600" },
  list: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  listTitle: { flex: 1, fontSize: 15, color: colors.text },
  listMeta: { fontSize: 13, color: colors.subtext },
});
