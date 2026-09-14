import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../src/lib/supabase";
import { useAuth } from "../src/lib/AuthProvider";
import { makeStyles, useColors } from "../src/lib/theme";
import { getPushStatus, registerPush, type PushStatus } from "../src/lib/push";
import { Button, Card, Chip, Loading, Muted } from "../src/components/ui";
import type { NotificationPrefs } from "../src/types/database";

type Category = "chores" | "chat" | "shopping" | "expenses" | "calendar" | "waste";
type Prefs = Record<Category, boolean> & { reminder_hour: number };

/** Morgens erinnert an heute, abends an morgen */
const REMINDER_HOURS = [7, 8, 9, 18, 19, 20, 21];

function reminderHint(hour: number) {
  return hour < 12
    ? `Um ${hour} Uhr morgens an alles, was heute ansteht`
    : `Um ${hour} Uhr am Vorabend an alles, was morgen ansteht`;
}

const CATEGORIES: { key: Category; icon: keyof typeof Ionicons.glyphMap; title: string; subtitle: string }[] = [
  {
    key: "chores",
    icon: "sparkles",
    title: "Putzplan",
    subtitle: "Erinnerung, wenn du dran bist – und wenn jemand deine Aufgabe übernimmt",
  },
  {
    key: "chat",
    icon: "chatbubbles",
    title: "Chat",
    subtitle: "Nachrichten, Ankündigungen, Bitten und neue Mitbewohner",
  },
  { key: "shopping", icon: "cart", title: "Einkauf", subtitle: "Wenn jemand einkaufen geht" },
  {
    key: "expenses",
    icon: "cash",
    title: "Kosten",
    subtitle: "Neue Ausgaben, an denen du beteiligt bist, und Rückzahlungen",
  },
  { key: "calendar", icon: "calendar", title: "Kalender", subtitle: "Neue Termine und Abwesenheiten" },
  { key: "waste", icon: "trash", title: "Müllabfuhr", subtitle: "Am Vorabend, welche Tonnen rausmüssen" },
];

const DEFAULTS: Prefs = {
  chores: true,
  chat: true,
  shopping: true,
  expenses: true,
  calendar: true,
  waste: true,
  reminder_hour: 18,
};

export default function NotificationsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { session } = useAuth();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [status, setStatus] = useState<PushStatus | null>(null);

  const refreshStatus = useCallback(() => {
    getPushStatus().then(setStatus);
  }, []);

  useEffect(() => {
    if (!session) return;
    supabase
      .from("notification_prefs")
      .select("*")
      .eq("user_id", session.user.id)
      .limit(1)
      .then(({ data }) => {
        const row = (data?.[0] as NotificationPrefs | undefined) ?? null;
        setPrefs(
          row
            ? {
                chores: row.chores,
                chat: row.chat,
                shopping: row.shopping,
                expenses: row.expenses,
                calendar: row.calendar,
                waste: row.waste,
                reminder_hour: row.reminder_hour,
              }
            : DEFAULTS
        );
      });
  }, [session]);

  // Wer aus den iOS-Einstellungen zurückkommt, soll den neuen Stand sofort sehen
  useEffect(() => {
    refreshStatus();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refreshStatus();
        registerPush({ ask: false });
      }
    });
    return () => subscription.remove();
  }, [refreshStatus]);

  if (!session || !prefs || !status) return <Loading />;

  const save = async (patch: Partial<Prefs>) => {
    const previous = prefs;
    setPrefs({ ...prefs, ...patch });
    const { error } = await supabase
      .from("notification_prefs")
      .upsert({ user_id: session.user.id, ...patch, updated_at: new Date().toISOString() });
    if (error) setPrefs(previous);
  };

  const allow = async () => {
    setStatus(await registerPush({ ask: true }));
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {status === "unsupported" && (
        <Card>
          <Muted>Mitteilungen gibt es nur in der App auf dem Handy. Was du hier einstellst, gilt dort.</Muted>
        </Card>
      )}
      {status === "undetermined" && (
        <Card style={{ gap: 10 }}>
          <Text style={styles.heading}>Mitteilungen sind noch aus</Text>
          <Muted>Erlaube sie einmal – welche du bekommst, stellst du unten ein.</Muted>
          <Button title="Mitteilungen erlauben" onPress={allow} />
        </Card>
      )}
      {status === "denied" && (
        <Card style={{ gap: 10 }}>
          <Text style={styles.heading}>In den iOS-Einstellungen ausgeschaltet</Text>
          <Muted>Solange sie dort aus sind, kommt nichts an – egal, was hier eingestellt ist.</Muted>
          <Button title="Einstellungen öffnen" variant="secondary" onPress={() => Linking.openSettings()} />
        </Card>
      )}
      {status === "granted" && (
        <View style={styles.grantedRow}>
          <Ionicons name="checkmark-circle" size={18} color={colors.successText} />
          <Text style={styles.grantedText}>Mitteilungen sind auf diesem Gerät an</Text>
        </View>
      )}

      <Card style={{ gap: 0, paddingVertical: 4 }}>
        {CATEGORIES.map((category, index) => (
          <View key={category.key} style={index < CATEGORIES.length - 1 && styles.rowDivider}>
            <View style={styles.row}>
              <Ionicons name={category.icon} size={20} color={colors.tint} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.rowTitle}>{category.title}</Text>
                <Text style={styles.rowSubtitle}>{category.subtitle}</Text>
              </View>
              <Switch
                value={prefs[category.key]}
                onValueChange={(value) => save({ [category.key]: value })}
                accessibilityLabel={category.title}
              />
            </View>
            {category.key === "chores" && prefs.chores && (
              <View style={styles.reminder}>
                <View style={styles.hourChips}>
                  {REMINDER_HOURS.map((hour) => (
                    <Chip
                      key={hour}
                      label={`${hour} Uhr`}
                      selected={prefs.reminder_hour === hour}
                      onPress={() => save({ reminder_hour: hour })}
                    />
                  ))}
                </View>
                <Text style={styles.rowSubtitle}>{reminderHint(prefs.reminder_hour)}</Text>
              </View>
            )}
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  heading: { fontSize: 16, fontWeight: "700", color: colors.text },
  grantedRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 },
  grantedText: { fontSize: 14, color: colors.text },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  rowSubtitle: { fontSize: 13, color: colors.subtext },
  reminder: { paddingLeft: 32, paddingBottom: 12, gap: 8 },
  hourChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
}));
