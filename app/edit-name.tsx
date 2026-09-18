import { useRef, useState } from "react";
import { router } from "expo-router";
import { Alert, ScrollView } from "react-native";
import { supabase } from "../src/lib/supabase";
import { describeError } from "../src/lib/connectivity";
import { useAuth } from "../src/lib/AuthProvider";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { useHouseholdMembers } from "../src/lib/useHouseholdMembers";
import { makeStyles } from "../src/lib/theme";
import { Button, Input, Loading, Muted } from "../src/components/ui";

/** Passt in Chips, Salden und Mitteilungen, ohne abgeschnitten zu werden */
const MAX_NAME_LENGTH = 40;

/** Eigenen Anzeigenamen ändern — gilt in allen WGs, in denen man ist */
export default function EditNameScreen() {
  const styles = useStyles();
  const { session } = useAuth();
  const { activeHousehold, households } = useHousehold();
  const { members, loading, refresh } = useHouseholdMembers(activeHousehold?.id);
  // null = noch nicht angefasst, dann steht der gespeicherte Name im Feld
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const current = members.find((member) => member.id === session?.user.id)?.full_name;
  if (loading || !session || current === undefined) return <Loading />;

  const value = draft ?? current;
  const cleaned = value.trim().replace(/\s+/g, " ");

  const save = async () => {
    if (savingRef.current || !cleaned) return;
    if (cleaned === current) {
      router.back();
      return;
    }

    savingRef.current = true;
    setSaving(true);
    const { error, status } = await supabase
      .from("profiles")
      .update({ full_name: cleaned })
      .eq("id", session.user.id);

    if (error) {
      savingRef.current = false;
      setSaving(false);
      Alert.alert("Name nicht gespeichert", describeError(error, status));
      return;
    }
    await refresh();
    router.back();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Input
        value={value}
        onChangeText={setDraft}
        placeholder="Dein Name"
        autoFocus
        autoCapitalize="words"
        autoCorrect={false}
        maxLength={MAX_NAME_LENGTH}
        returnKeyType="done"
        onSubmitEditing={save}
      />
      <Muted>
        So sehen dich deine Mitbewohner im Putzplan, bei Ausgaben und im Chat
        {households.length > 1 ? " – in allen deinen WGs." : "."} Der Vorname reicht meistens.
      </Muted>
      <Button title="Speichern" onPress={save} loading={saving} disabled={!cleaned} />
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 12 },
}));
