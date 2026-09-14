import { useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../src/lib/supabase";
import { useAuth } from "../src/lib/AuthProvider";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { makeStyles, useColors } from "../src/lib/theme";
import { hapticSuccess } from "../src/lib/haptics";
import { MAX_POLL_OPTIONS, markPollSent, nextDaysOptions } from "../src/lib/polls";
import { Button, Chip, ErrorText, Input, Loading, Muted, SectionTitle } from "../src/components/ui";

const TEMPLATES: { label: string; options: () => string[]; multiple: boolean }[] = [
  { label: "Ja / Nein", options: () => ["Ja", "Nein"], multiple: false },
  { label: "Ja / Nein / Vielleicht", options: () => ["Ja", "Nein", "Vielleicht"], multiple: false },
  // Bei Terminen kreuzt jeder alle Tage an, die passen
  { label: "Nächste 7 Tage", options: () => nextDaysOptions(), multiple: true },
];

/** Hinten steht immer genau ein leeres Feld für die nächste Antwort */
function withEmptySlot(options: string[]): string[] {
  const kept = options.slice(0, MAX_POLL_OPTIONS);
  while (kept.length > 0 && kept[kept.length - 1].trim() === "") kept.pop();
  if (kept.length < MAX_POLL_OPTIONS) kept.push("");
  while (kept.length < 2) kept.push("");
  return kept;
}

export default function NewPoll() {
  const styles = useStyles();
  const colors = useColors();
  const params = useLocalSearchParams<{ question?: string }>();
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const [question, setQuestion] = useState(params.question ?? "");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [multiple, setMultiple] = useState(false);
  // Antworten aus einer Vorlage darf die nächste Vorlage ersetzen, eigene nicht
  const [fromTemplate, setFromTemplate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const optionRefs = useRef<(TextInput | null)[]>([]);

  if (!session || !activeHousehold) return <Loading />;

  const filled = options.map((option) => option.trim()).filter(Boolean);

  const applyTemplate = (template: (typeof TEMPLATES)[number]) => {
    setOptions(withEmptySlot(template.options()));
    setMultiple(template.multiple);
    setFromTemplate(true);
  };

  const changeOption = (index: number, value: string) => {
    setOptions((prev) => withEmptySlot(prev.map((option, i) => (i === index ? value : option))));
    setFromTemplate(false);
  };

  const removeOption = (index: number) => {
    setOptions((prev) => withEmptySlot(prev.filter((_, i) => i !== index)));
  };

  const submit = async () => {
    const text = question.trim();
    if (!text) return setError("Was möchtest du fragen?");
    if (filled.length < 2) return setError("Eine Umfrage braucht mindestens zwei Antworten.");
    const lower = filled.map((option) => option.toLowerCase());
    if (new Set(lower).size !== lower.length) return setError("Zwei Antworten sind gleich.");

    setError(null);
    setSaving(true);
    const { error: insertError } = await supabase.from("chat_messages").insert({
      household_id: activeHousehold.id,
      user_id: session.user.id,
      content: text,
      kind: "poll",
      poll_options: filled,
      poll_multiple: multiple,
    });
    setSaving(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    hapticSuccess();
    markPollSent();
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/chat");
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <SectionTitle>Frage</SectionTitle>
      <Input
        placeholder="z.B. Wann machen wir WG-Abend?"
        value={question}
        onChangeText={setQuestion}
        autoFocus={!params.question}
        maxLength={200}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => optionRefs.current[0]?.focus()}
      />

      <SectionTitle>Antworten</SectionTitle>
      {/* Sobald eigene Antworten dastehen, verschwinden die Vorlagen — sie würden sie sonst überschreiben */}
      {(filled.length === 0 || fromTemplate) && (
        <View style={styles.chipWrap}>
          {TEMPLATES.map((template) => (
            <Chip
              key={template.label}
              label={template.label}
              selected={fromTemplate && filled.join("|") === template.options().join("|")}
              onPress={() => applyTemplate(template)}
            />
          ))}
        </View>
      )}

      {options.map((option, index) => {
        const isEmptySlot = index === options.length - 1 && option.trim() === "" && index >= 2;
        return (
          <View key={index} style={styles.optionRow}>
            <Ionicons
              name={multiple ? "square-outline" : "radio-button-off"}
              size={20}
              color={colors.subtext}
            />
            <Input
              ref={(input) => {
                optionRefs.current[index] = input;
              }}
              style={styles.optionInput}
              placeholder={isEmptySlot ? "Weitere Antwort" : `Antwort ${index + 1}`}
              value={option}
              onChangeText={(value) => changeOption(index, value)}
              maxLength={100}
              returnKeyType={index < options.length - 1 ? "next" : "done"}
              submitBehavior={index < options.length - 1 ? "submit" : "blurAndSubmit"}
              onSubmitEditing={() => optionRefs.current[index + 1]?.focus()}
            />
            {!isEmptySlot && options.length > 2 ? (
              <TouchableOpacity
                onPress={() => removeOption(index)}
                style={styles.removeButton}
                accessibilityLabel={`Antwort ${index + 1} entfernen`}
              >
                <Ionicons name="close" size={18} color={colors.subtext} />
              </TouchableOpacity>
            ) : (
              <View style={styles.removeButton} />
            )}
          </View>
        );
      })}

      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.switchLabel}>Mehrere Antworten erlauben</Text>
          <Muted>Praktisch bei Terminen: jeder wählt alles, was passt.</Muted>
        </View>
        <Switch value={multiple} onValueChange={setMultiple} />
      </View>

      {error && <ErrorText>{error}</ErrorText>}

      <Button title="Umfrage senden" onPress={submit} loading={saving} />
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  optionRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  optionInput: { flex: 1, paddingVertical: 9 },
  removeButton: { width: 30, alignItems: "center" },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 },
  switchLabel: { fontSize: 15, color: colors.text, fontWeight: "600" },
}));
