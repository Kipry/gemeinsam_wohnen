import { useState } from "react";
import { router } from "expo-router";
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { supabase } from "../src/lib/supabase";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { useHouseholdMembers } from "../src/lib/useHouseholdMembers";
import { useTeams } from "../src/lib/useTeams";
import { colors } from "../src/lib/theme";
import { Button, Chip, ErrorText, Input, Muted, SectionTitle } from "../src/components/ui";
import type { AssignmentMode } from "../src/types/database";

const MODES: { value: AssignmentMode; label: string; hint: string }[] = [
  { value: "anyone", label: "Wer mag", hint: "Niemand fest zugeteilt — wer zuerst kommt, hakt ab." },
  {
    value: "rotation_member",
    label: "Reihum: Personen",
    hint: "Nach jedem Erledigen ist die nächste Person aus der Reihenfolge dran.",
  },
  {
    value: "rotation_team",
    label: "Reihum: Teams",
    hint: "Nach jedem Erledigen ist das nächste Team dran.",
  },
  { value: "fixed", label: "Feste Person", hint: "Immer dieselbe Person ist zuständig." },
];

export default function NewTask() {
  const { activeHousehold } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);
  const { teams } = useTeams(activeHousehold?.id);

  const [title, setTitle] = useState("");
  const [points, setPoints] = useState("1");
  const [intervalDays, setIntervalDays] = useState("7");
  const [mode, setMode] = useState<AssignmentMode>("anyone");
  const [rotation, setRotation] = useState<string[]>([]);
  const [fixedAssignee, setFixedAssignee] = useState<string | null>(null);
  const [skipAbsent, setSkipAbsent] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggleRotation = (id: string) => {
    setRotation((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const switchMode = (next: AssignmentMode) => {
    setMode(next);
    setRotation([]);
    setFixedAssignee(null);
  };

  const save = async () => {
    if (!activeHousehold) return;
    if (!title.trim()) {
      setError("Bitte einen Titel eingeben.");
      return;
    }
    if ((mode === "rotation_member" || mode === "rotation_team") && rotation.length === 0) {
      setError("Bitte mindestens eine Person bzw. ein Team für die Reihenfolge wählen.");
      return;
    }
    if (mode === "fixed" && !fixedAssignee) {
      setError("Bitte eine zuständige Person wählen.");
      return;
    }

    setError(null);
    setSaving(true);

    const { error: rpcError } = await supabase.rpc("create_task", {
      p_household_id: activeHousehold.id,
      p_title: title.trim(),
      p_points: Number(points) || 1,
      p_interval_days: Number(intervalDays) || 7,
      p_assignment_mode: mode,
      p_rotation:
        mode === "rotation_member"
          ? rotation.map((id) => ({ user_id: id }))
          : mode === "rotation_team"
            ? rotation.map((id) => ({ team_id: id }))
            : [],
      p_fixed_assignee: mode === "fixed" ? fixedAssignee : null,
      p_skip_absent: skipAbsent,
    });

    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/tasks");
  };

  const rotationSource =
    mode === "rotation_team"
      ? teams.map((t) => ({ id: t.id, label: t.name }))
      : members.map((m) => ({ id: m.id, label: m.full_name }));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <SectionTitle>Aufgabe</SectionTitle>
      <Input placeholder="z.B. Bad putzen" value={title} onChangeText={setTitle} />

      <View style={styles.twoCol}>
        <View style={{ flex: 1, gap: 4 }}>
          <Muted>Punkte</Muted>
          <Input value={points} onChangeText={setPoints} keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Muted>Alle ... Tage</Muted>
          <Input value={intervalDays} onChangeText={setIntervalDays} keyboardType="number-pad" />
        </View>
      </View>

      <SectionTitle>Zuteilung</SectionTitle>
      <View style={styles.chipWrap}>
        {MODES.map((m) => (
          <Chip
            key={m.value}
            label={m.label}
            selected={mode === m.value}
            onPress={() => switchMode(m.value)}
          />
        ))}
      </View>
      <Muted>{MODES.find((m) => m.value === mode)?.hint}</Muted>

      {(mode === "rotation_member" || mode === "rotation_team") && (
        <>
          <SectionTitle>
            Reihenfolge {rotation.length > 0 ? `(${rotation.length} gewählt)` : ""}
          </SectionTitle>
          <Muted>In der Reihenfolge antippen, in der abgewechselt werden soll.</Muted>

          {mode === "rotation_team" && teams.length === 0 && (
            <TouchableOpacity onPress={() => router.push("/teams")}>
              <Text style={styles.link}>Noch keine Teams — jetzt Teams anlegen</Text>
            </TouchableOpacity>
          )}

          <View style={styles.chipWrap}>
            {rotationSource.map((entry) => {
              const index = rotation.indexOf(entry.id);
              return (
                <Chip
                  key={entry.id}
                  label={index >= 0 ? `${index + 1}. ${entry.label}` : entry.label}
                  selected={index >= 0}
                  onPress={() => toggleRotation(entry.id)}
                />
              );
            })}
          </View>
        </>
      )}

      {mode === "fixed" && (
        <>
          <SectionTitle>Zuständig</SectionTitle>
          <View style={styles.chipWrap}>
            {members.map((m) => (
              <Chip
                key={m.id}
                label={m.full_name}
                selected={fixedAssignee === m.id}
                onPress={() => setFixedAssignee(m.id)}
              />
            ))}
          </View>
        </>
      )}

      {mode === "rotation_member" && (
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>Abwesende überspringen</Text>
            <Muted>Wer im Urlaub ist, wird in der Rotation übersprungen.</Muted>
          </View>
          <Switch value={skipAbsent} onValueChange={setSkipAbsent} />
        </View>
      )}

      {error && <ErrorText>{error}</ErrorText>}

      <Button title="Aufgabe anlegen" onPress={save} loading={saving} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  twoCol: { flexDirection: "row", gap: 10 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 },
  switchLabel: { fontSize: 15, color: colors.text, fontWeight: "600" },
  link: { color: colors.primary, fontWeight: "600" },
});
