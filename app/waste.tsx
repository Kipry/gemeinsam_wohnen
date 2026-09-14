import { useCallback, useEffect, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../src/lib/supabase";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { useWaste } from "../src/lib/useWaste";
import { makeStyles, useColors } from "../src/lib/theme";
import { formatShort, todayISO } from "../src/lib/dates";
import { WASTE_KINDS, nextCollection, rhythmText, weekdayOf } from "../src/lib/waste";
import { Button, Card, Loading, Muted, SectionTitle } from "../src/components/ui";

export default function WasteScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { activeHousehold } = useHousehold();
  const { bins, changes, loading, reload } = useWaste(activeHousehold?.id);
  const [hasBinTask, setHasBinTask] = useState(true);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  // Gibt es schon eine Putzplan-Aufgabe fürs Rausstellen?
  useEffect(() => {
    if (!activeHousehold) return;
    supabase
      .from("tasks")
      .select("title")
      .eq("household_id", activeHousehold.id)
      .then(({ data }) => {
        setHasBinTask((data ?? []).some((task) => /tonne|müll/i.test(task.title)));
      });
  }, [activeHousehold, bins.length]);

  if (loading) return <Loading />;

  const today = todayISO();

  // Rausstellen am Vorabend des häufigsten Abholtags
  const suggestTask = () => {
    const counts = new Map<number, number>();
    for (const bin of bins) {
      const weekday = weekdayOf(bin.first_date);
      counts.set(weekday, (counts.get(weekday) ?? 0) + 1);
    }
    const pickupDay = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 5;
    router.push({
      pathname: "/new-task",
      params: { title: "Mülltonnen rausstellen", weekday: String((pickupDay + 6) % 7), interval: "7" },
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {bins.length === 0 ? (
        <Card style={{ gap: 12 }}>
          <Text style={styles.heading}>Wann kommt die Müllabfuhr?</Text>
          <Muted>
            Einmal eintragen, welche Tonne wann abgeholt wird. Die Termine stehen dann im Kalender, und
            am Vorabend erinnert die App ans Rausstellen.
          </Muted>
          <View style={styles.quickRow}>
            {WASTE_KINDS.filter((entry) => entry.kind !== "sonstige").map((entry) => (
              <TouchableOpacity
                key={entry.kind}
                style={styles.quickChip}
                onPress={() => router.push({ pathname: "/waste-bin", params: { kind: entry.kind } })}
              >
                <Ionicons name="trash" size={16} color={colors.waste[entry.kind]} />
                <Text style={styles.quickText}>{entry.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>
      ) : (
        <>
          <SectionTitle>Tonnen</SectionTitle>
          {bins.map((bin) => {
            const next = nextCollection(bin, changes, today);
            return (
              <TouchableOpacity
                key={bin.id}
                onPress={() => router.push({ pathname: "/waste-bin", params: { id: bin.id } })}
              >
                <Card style={styles.binRow}>
                  <Ionicons name="trash" size={22} color={colors.waste[bin.kind]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.binTitle}>{bin.label}</Text>
                    <Text style={styles.binMeta}>
                      {rhythmText(bin)}
                      {next ? ` · nächste: ${next.date === today ? "heute" : formatShort(next.date)}` : ""}
                      {next?.status === "moved" ? " (verschoben)" : ""}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
                </Card>
              </TouchableOpacity>
            );
          })}
        </>
      )}

      <Button
        title={bins.length === 0 ? "Andere Tonne eintragen" : "Tonne hinzufügen"}
        variant="secondary"
        onPress={() => router.push("/waste-bin")}
      />

      {bins.length > 0 && (
        <>
          <Card style={styles.infoRow}>
            <Ionicons name="notifications-outline" size={20} color={colors.tint} />
            <View style={{ flex: 1 }}>
              <Text style={styles.infoTitle}>Erinnerung am Vorabend</Text>
              <Muted>
                Zu deiner Erinnerungszeit, wenn sie abends liegt, sonst um 19 Uhr. Einzelne Abholungen
                verschiebst du im Kalender, indem du den Tag antippst.
              </Muted>
            </View>
          </Card>

          {!hasBinTask && (
            <TouchableOpacity onPress={suggestTask}>
              <Card style={styles.infoRow}>
                <Ionicons name="sparkles" size={20} color={colors.tint} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoTitle}>Wer stellt die Tonnen raus?</Text>
                  <Muted>Als Aufgabe in den Putzplan — dann wechselt ihr euch ab.</Muted>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
              </Card>
            </TouchableOpacity>
          )}
        </>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  heading: { fontSize: 17, fontWeight: "700", color: colors.text },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  quickChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  quickText: { fontSize: 14, color: colors.text },
  binRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  binTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  binMeta: { fontSize: 13, color: colors.subtext, marginTop: 2 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  infoTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
}));
