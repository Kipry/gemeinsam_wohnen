import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { supabase } from "../src/lib/supabase";
import { useAuth } from "../src/lib/AuthProvider";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { todayISO } from "../src/lib/dates";
import { EventForm, type EventFormValues } from "../src/components/EventForm";
import { ErrorText, Loading } from "../src/components/ui";
import type { EventKind } from "../src/types/database";

// Wer einen WG-Abend oder Termin einträgt, ist in aller Regel selbst dabei.
// Beim Handwerker oder Besuch sagt die Zusage etwas anderes aus ("mache auf").
const CREATOR_ATTENDS: EventKind[] = ["termin", "wg_abend", "geburtstag"];

export default function NewEvent() {
  const { date } = useLocalSearchParams<{ date?: string }>();
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session || !activeHousehold) return <Loading />;

  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayISO();

  const save = async (values: EventFormValues) => {
    setSaving(true);
    const { data, error: insertError } = await supabase
      .from("calendar_events")
      .insert({ ...values, household_id: activeHousehold.id, created_by: session.user.id })
      .select("id")
      .single();

    if (insertError || !data) {
      setSaving(false);
      setError(insertError?.message ?? "Termin konnte nicht gespeichert werden");
      return;
    }

    if (CREATOR_ATTENDS.includes(values.kind)) {
      await supabase
        .from("calendar_event_attendees")
        .insert({ event_id: data.id, user_id: session.user.id, status: "yes" });
    }

    setSaving(false);
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/calendar");
  };

  return (
    <>
      {error && <ErrorText>{error}</ErrorText>}
      <EventForm
        initial={{
          kind: "termin",
          title: "",
          note: null,
          starts_on: day,
          ends_on: day,
          start_time: null,
          end_time: null,
        }}
        submitLabel="Termin eintragen"
        saving={saving}
        onSubmit={save}
      />
    </>
  );
}
