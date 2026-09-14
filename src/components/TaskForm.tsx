import { useState, type ReactNode } from "react";
import { router } from "expo-router";
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { colors } from "../lib/theme";
import { Button, Chip, ErrorText, Input, Muted, SectionTitle } from "./ui";
import type { AssignmentMode, HouseholdPlaceholder, Profile } from "../types/database";
import type { TeamWithMembers } from "../lib/useTeams";

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

/** Häufige WG-Aufgaben, damit man nicht vor einem leeren Formular sitzt. */
export const TEMPLATES: { title: string; points: number; interval_days: number }[] = [
  { title: "Müll rausbringen", points: 1, interval_days: 7 },
  { title: "Bad putzen", points: 3, interval_days: 7 },
  { title: "Küche putzen", points: 3, interval_days: 7 },
  { title: "Staubsaugen", points: 2, interval_days: 7 },
  { title: "Spülmaschine ausräumen", points: 1, interval_days: 2 },
  { title: "Bad-Handtücher wechseln", points: 1, interval_days: 14 },
];

/** 0 = Sonntag, passend zu extract(dow) in Postgres */
const WEEKDAYS = [
  { value: 1, label: "Mo" },
  { value: 2, label: "Di" },
  { value: 3, label: "Mi" },
  { value: 4, label: "Do" },
  { value: 5, label: "Fr" },
  { value: 6, label: "Sa" },
  { value: 0, label: "So" },
];

export type TaskFormValues = {
  title: string;
  points: number;
  interval_days: number;
  assignment_mode: AssignmentMode;
  rotation: { user_id?: string; team_id?: string }[];
  fixed_assignee: string | null;
  skip_absent: boolean;
  weekday: number | null;
};

export type TaskFormInitial = {
  title: string;
  points: string;
  interval_days: string;
  assignment_mode: AssignmentMode;
  rotation: string[];
  fixed_assignee: string | null;
  skip_absent: boolean;
  weekday: number | null;
};

export function TaskForm({
  members,
  teams,
  placeholders = [],
  currentUserId,
  initial,
  submitLabel,
  saving,
  onSubmit,
  footer,
}: {
  members: Profile[];
  teams: TeamWithMembers[];
  /** Noch nicht beigetretene Mitbewohner — dürfen schon in der Rotation stehen */
  placeholders?: HouseholdPlaceholder[];
  currentUserId: string;
  initial?: TaskFormInitial;
  submitLabel: string;
  saving: boolean;
  onSubmit: (values: TaskFormValues) => void;
  footer?: ReactNode;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [points, setPoints] = useState(initial?.points ?? "1");
  const [intervalDays, setIntervalDays] = useState(initial?.interval_days ?? "7");
  const [mode, setMode] = useState<AssignmentMode>(initial?.assignment_mode ?? "anyone");
  const [rotation, setRotation] = useState<string[]>(initial?.rotation ?? []);
  const [fixedAssignee, setFixedAssignee] = useState<string | null>(initial?.fixed_assignee ?? null);
  const [skipAbsent, setSkipAbsent] = useState(initial?.skip_absent ?? true);
  const [weekday, setWeekday] = useState<number | null>(initial?.weekday ?? null);
  const [error, setError] = useState<string | null>(null);

  const nameFor = (id: string) =>
    id === currentUserId ? "Du" : members.find((m) => m.id === id)?.full_name ?? "?";

  const applyTemplate = (template: (typeof TEMPLATES)[number]) => {
    setTitle(template.title);
    setPoints(String(template.points));
    setIntervalDays(String(template.interval_days));
  };

  const toggleRotation = (id: string) => {
    setRotation((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const switchMode = (next: AssignmentMode) => {
    setMode(next);
    setRotation([]);
    setFixedAssignee(null);
  };

  const submit = () => {
    if (!title.trim()) return setError("Bitte einen Titel eingeben.");
    if ((mode === "rotation_member" || mode === "rotation_team") && rotation.length === 0) {
      return setError("Bitte mindestens eine Person bzw. ein Team für die Reihenfolge wählen.");
    }
    if (mode === "fixed" && !fixedAssignee) {
      return setError("Bitte eine zuständige Person wählen.");
    }

    setError(null);
    onSubmit({
      title: title.trim(),
      points: Number(points) || 1,
      interval_days: Number(intervalDays) || 7,
      assignment_mode: mode,
      rotation:
        mode === "rotation_member"
          ? rotation.map((id) =>
              placeholders.some((placeholder) => placeholder.id === id)
                ? { placeholder_id: id }
                : { user_id: id }
            )
          : mode === "rotation_team"
            ? rotation.map((id) => ({ team_id: id }))
            : [],
      fixed_assignee: mode === "fixed" ? fixedAssignee : null,
      skip_absent: skipAbsent,
      weekday,
    });
  };

  const rotationSource =
    mode === "rotation_team"
      ? teams.map((team) => ({ id: team.id, label: team.name }))
      : [
          ...members.map((member) => ({ id: member.id, label: nameFor(member.id) })),
          ...placeholders.map((placeholder) => ({
            id: placeholder.id,
            label: `${placeholder.name} (noch nicht dabei)`,
          })),
        ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {!initial && (
        <>
          <SectionTitle>Vorlagen</SectionTitle>
          <View style={styles.chipWrap}>
            {TEMPLATES.map((template) => (
              <Chip
                key={template.title}
                label={template.title}
                selected={title === template.title}
                onPress={() => applyTemplate(template)}
              />
            ))}
          </View>
        </>
      )}

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

      <SectionTitle>Fester Wochentag</SectionTitle>
      <View style={styles.chipWrap}>
        <Chip label="Egal" selected={weekday === null} onPress={() => setWeekday(null)} />
        {WEEKDAYS.map((day) => (
          <Chip
            key={day.value}
            label={day.label}
            selected={weekday === day.value}
            onPress={() => setWeekday(day.value)}
          />
        ))}
      </View>
      <Muted>
        Mit festem Wochentag bleibt „Müll dienstags" auch dann dienstags, wenn mal später
        abgehakt wird.
      </Muted>

      <SectionTitle>Zuteilung</SectionTitle>
      <View style={styles.chipWrap}>
        {MODES.map((entry) => (
          <Chip
            key={entry.value}
            label={entry.label}
            selected={mode === entry.value}
            onPress={() => switchMode(entry.value)}
          />
        ))}
      </View>
      <Muted>{MODES.find((entry) => entry.value === mode)?.hint}</Muted>

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
            {members.map((member) => (
              <Chip
                key={member.id}
                label={nameFor(member.id)}
                selected={fixedAssignee === member.id}
                onPress={() => setFixedAssignee(member.id)}
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

      <Button title={submitLabel} onPress={submit} loading={saving} />
      {footer}
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
