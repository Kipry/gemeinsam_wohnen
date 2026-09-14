import { useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { makeStyles } from "../lib/theme";
import { EVENT_KINDS, EVENT_KIND_ORDER } from "../lib/eventKinds";
import { Button, Chip, ErrorText, Input, Muted, SectionTitle } from "./ui";
import { DateStepper, TimeStepper } from "./Steppers";
import type { EventKind } from "../types/database";

export type EventFormValues = {
  kind: EventKind;
  title: string;
  note: string | null;
  starts_on: string;
  ends_on: string;
  start_time: string | null;
  end_time: string | null;
};

export function EventForm({
  initial,
  submitLabel,
  saving,
  onSubmit,
  footer,
}: {
  initial: EventFormValues;
  submitLabel: string;
  saving: boolean;
  onSubmit: (values: EventFormValues) => void;
  footer?: ReactNode;
}) {
  const styles = useStyles();
  const [kind, setKind] = useState<EventKind>(initial.kind);
  const [title, setTitle] = useState(initial.title);
  const [note, setNote] = useState(initial.note ?? "");
  const [startsOn, setStartsOn] = useState(initial.starts_on);
  const [endsOn, setEndsOn] = useState(initial.ends_on);
  const [multiDay, setMultiDay] = useState(initial.ends_on !== initial.starts_on);
  const [withTime, setWithTime] = useState(initial.start_time !== null);
  const [startTime, setStartTime] = useState(initial.start_time?.slice(0, 5) ?? "18:00");
  const [withEnd, setWithEnd] = useState(initial.end_time !== null);
  const [endTime, setEndTime] = useState(initial.end_time?.slice(0, 5) ?? "20:00");
  const [error, setError] = useState<string | null>(null);

  const pickKind = (next: EventKind) => {
    // Titel nur überschreiben, solange er noch der Vorschlag der alten Art ist
    if (!title.trim() || title === EVENT_KINDS[kind].defaultTitle) {
      setTitle(EVENT_KINDS[next].defaultTitle);
    }
    setKind(next);
  };

  // Das Ende darf nie vor dem Anfang liegen — beim Verschieben einfach mitziehen
  const changeStart = (next: string) => {
    setStartsOn(next);
    if (endsOn < next) setEndsOn(next);
  };

  const changeEnd = (next: string) => {
    setEndsOn(next < startsOn ? startsOn : next);
  };

  const submit = () => {
    const finalTitle = title.trim() || EVENT_KINDS[kind].label;
    const finalEnd = multiDay ? endsOn : startsOn;

    if (withTime && withEnd && finalEnd === startsOn && endTime < startTime) {
      return setError("Das Ende liegt vor dem Beginn.");
    }

    setError(null);
    onSubmit({
      kind,
      title: finalTitle,
      note: note.trim() || null,
      starts_on: startsOn,
      ends_on: finalEnd,
      start_time: withTime ? startTime : null,
      end_time: withTime && withEnd ? endTime : null,
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <SectionTitle>Art</SectionTitle>
      <View style={styles.chipWrap}>
        {EVENT_KIND_ORDER.map((entry) => (
          <Chip
            key={entry}
            label={EVENT_KINDS[entry].label}
            selected={kind === entry}
            onPress={() => pickKind(entry)}
          />
        ))}
      </View>

      <Input placeholder="Titel, z.B. Grillen im Hof" value={title} onChangeText={setTitle} />

      <SectionTitle>Wann</SectionTitle>
      <View style={styles.chipWrap}>
        <Chip label="Ein Tag" selected={!multiDay} onPress={() => setMultiDay(false)} />
        <Chip label="Mehrere Tage" selected={multiDay} onPress={() => setMultiDay(true)} />
      </View>
      <DateStepper label={multiDay ? "Von" : "Am"} value={startsOn} onChange={changeStart} />
      {multiDay && <DateStepper label="Bis" value={endsOn} onChange={changeEnd} />}

      <View style={styles.chipWrap}>
        <Chip label="Ganztägig" selected={!withTime} onPress={() => setWithTime(false)} />
        <Chip label="Mit Uhrzeit" selected={withTime} onPress={() => setWithTime(true)} />
      </View>
      {withTime && (
        <>
          <TimeStepper label="Um" value={startTime} onChange={setStartTime} />
          <View style={styles.chipWrap}>
            <Chip label="Mit Endzeit" selected={withEnd} onPress={() => setWithEnd(!withEnd)} />
          </View>
          {withEnd && <TimeStepper label="Bis" value={endTime} onChange={setEndTime} />}
        </>
      )}

      <Input placeholder="Notiz (optional)" value={note} onChangeText={setNote} multiline />

      {kind === "handwerker" && (
        <Muted>Im Termin kann jemand „Ich mache auf" antippen — dann weiß jeder, wer zu Hause ist.</Muted>
      )}

      {error && <ErrorText>{error}</ErrorText>}

      <Button title={submitLabel} onPress={submit} loading={saving} />
      {footer}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
}));
