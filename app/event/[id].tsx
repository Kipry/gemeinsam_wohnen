import { useCallback, useState } from "react";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/lib/AuthProvider";
import { useHousehold } from "../../src/lib/HouseholdProvider";
import { FORMER_MEMBER, useHouseholdMembers } from "../../src/lib/useHouseholdMembers";
import { colors } from "../../src/lib/theme";
import { formatLong, formatShort, formatTime } from "../../src/lib/dates";
import { EVENT_KINDS } from "../../src/lib/eventKinds";
import { EventForm, type EventFormValues } from "../../src/components/EventForm";
import { Button, Card, ErrorText, Loading } from "../../src/components/ui";
import type { CalendarEvent, CalendarEventAttendee } from "../../src/types/database";

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [attendees, setAttendees] = useState<CalendarEventAttendee[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const [eventResult, attendeeResult] = await Promise.all([
      supabase.from("calendar_events").select("*").eq("id", id).maybeSingle(),
      supabase.from("calendar_event_attendees").select("*").eq("event_id", id),
    ]);

    if (eventResult.error) setError(eventResult.error.message);
    setEvent((eventResult.data as CalendarEvent) ?? null);
    setAttendees((attendeeResult.data as CalendarEventAttendee[]) ?? []);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!session) return <Loading />;
  if (!event) return error ? <ErrorText>{error}</ErrorText> : <Loading />;

  const kind = EVENT_KINDS[event.kind];
  const myStatus = attendees.find((entry) => entry.user_id === session.user.id)?.status ?? null;
  const yes = attendees.filter((entry) => entry.status === "yes");
  const no = attendees.filter((entry) => entry.status === "no");
  const open = members.filter((member) => !attendees.some((entry) => entry.user_id === member.id));

  const nameFor = (userId: string) =>
    userId === session.user.id ? "Du" : members.find((m) => m.id === userId)?.full_name ?? FORMER_MEMBER;

  const respond = async (status: "yes" | "no") => {
    // Nochmal auf dieselbe Antwort tippen nimmt sie zurück
    if (myStatus === status) {
      await supabase
        .from("calendar_event_attendees")
        .delete()
        .eq("event_id", event.id)
        .eq("user_id", session.user.id);
    } else {
      await supabase.from("calendar_event_attendees").upsert({
        event_id: event.id,
        user_id: session.user.id,
        status,
        responded_at: new Date().toISOString(),
      });
    }
    load();
  };

  const save = async (values: EventFormValues) => {
    setSaving(true);
    const { error: updateError } = await supabase
      .from("calendar_events")
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("id", event.id);
    setSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    setEditing(false);
    load();
  };

  const remove = () => {
    Alert.alert("Termin löschen", `„${event.title}" aus dem Kalender nehmen?`, [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Löschen",
        style: "destructive",
        onPress: async () => {
          const { error: deleteError } = await supabase
            .from("calendar_events")
            .delete()
            .eq("id", event.id);
          if (deleteError) {
            setError(deleteError.message);
            return;
          }
          if (router.canGoBack()) router.back();
          else router.replace("/(tabs)/calendar");
        },
      },
    ]);
  };

  if (editing) {
    return (
      <>
        {error && <ErrorText>{error}</ErrorText>}
        <EventForm
          initial={{
            kind: event.kind,
            title: event.title,
            note: event.note,
            starts_on: event.starts_on,
            ends_on: event.ends_on,
            start_time: event.start_time,
            end_time: event.end_time,
          }}
          submitLabel="Änderungen speichern"
          saving={saving}
          onSubmit={save}
          footer={<Button title="Abbrechen" variant="secondary" onPress={() => setEditing(false)} />}
        />
      </>
    );
  }

  const start = formatTime(event.start_time);
  const end = formatTime(event.end_time);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card>
        <View style={styles.kindRow}>
          <Ionicons name={kind.icon} size={16} color={colors.primary} />
          <Text style={styles.kindLabel}>{kind.label}</Text>
        </View>
        <Text style={styles.title}>{event.title}</Text>
        <Text style={styles.when}>
          {event.starts_on === event.ends_on
            ? formatLong(event.starts_on)
            : `${formatShort(event.starts_on)} – ${formatShort(event.ends_on)}`}
        </Text>
        <Text style={styles.meta}>
          {start ? `${start}${end ? `–${end}` : ""} Uhr` : "ganztägig"} ·{" "}
          {event.created_by === session.user.id
            ? "von dir eingetragen"
            : `eingetragen von ${nameFor(event.created_by)}`}
        </Text>
        {event.note ? <Text style={styles.note}>{event.note}</Text> : null}
      </Card>

      <Card>
        <View style={styles.rsvpRow}>
          <TouchableOpacity
            style={[styles.rsvpButton, myStatus === "yes" && styles.rsvpYes]}
            onPress={() => respond("yes")}
          >
            <Ionicons
              name="checkmark"
              size={18}
              color={myStatus === "yes" ? "#fff" : colors.success}
            />
            <Text style={[styles.rsvpText, myStatus === "yes" && styles.rsvpTextActive]}>
              {kind.rsvpLabel}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.rsvpButton, myStatus === "no" && styles.rsvpNo]}
            onPress={() => respond("no")}
          >
            <Ionicons name="close" size={18} color={myStatus === "no" ? "#fff" : colors.subtext} />
            <Text style={[styles.rsvpText, myStatus === "no" && styles.rsvpTextActive]}>Nein</Text>
          </TouchableOpacity>
        </View>

        <AttendeeLine
          label={kind.attendeeVerb}
          names={yes.map((entry) => nameFor(entry.user_id))}
        />
        <AttendeeLine label="nicht" names={no.map((entry) => nameFor(entry.user_id))} />
        <AttendeeLine label="noch offen" names={open.map((member) => nameFor(member.id))} />
      </Card>

      {error && <ErrorText>{error}</ErrorText>}

      <Button title="Bearbeiten" variant="secondary" onPress={() => setEditing(true)} />
      <Button title="Löschen" variant="danger" onPress={remove} />
    </ScrollView>
  );
}

function AttendeeLine({ label, names }: { label: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <Text style={styles.attendeeLine}>
      <Text style={styles.attendeeLabel}>{label}: </Text>
      {names.join(", ")}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  kindRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  kindLabel: { fontSize: 13, fontWeight: "600", color: colors.primary },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  when: { fontSize: 15, color: colors.text },
  meta: { fontSize: 13, color: colors.subtext },
  note: { fontSize: 14, color: colors.text, marginTop: 4 },
  rsvpRow: { flexDirection: "row", gap: 10 },
  rsvpButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  rsvpYes: { backgroundColor: colors.success, borderColor: colors.success },
  rsvpNo: { backgroundColor: colors.subtext, borderColor: colors.subtext },
  rsvpText: { fontSize: 15, fontWeight: "600", color: colors.text },
  rsvpTextActive: { color: "#fff" },
  attendeeLine: { fontSize: 14, color: colors.text },
  attendeeLabel: { color: colors.subtext },
});
