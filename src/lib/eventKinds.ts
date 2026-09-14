import type { Ionicons } from "@expo/vector-icons";
import type { EventKind } from "../types/database";

type KindInfo = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Titel-Vorschlag, wenn noch nichts eingetragen ist */
  defaultTitle: string;
  /** Knopf zum Zusagen — beim Handwerker zählt, wer die Tür aufmacht, nicht wer "dabei" ist */
  rsvpLabel: string;
  /** "3 dabei", "Anna macht auf" */
  attendeeVerb: string;
};

export const EVENT_KINDS: Record<EventKind, KindInfo> = {
  termin: {
    label: "Termin",
    icon: "calendar",
    defaultTitle: "",
    rsvpLabel: "Bin dabei",
    attendeeVerb: "dabei",
  },
  wg_abend: {
    label: "WG-Abend",
    icon: "people",
    defaultTitle: "WG-Abend",
    rsvpLabel: "Bin dabei",
    attendeeVerb: "dabei",
  },
  besuch: {
    label: "Besuch",
    icon: "home",
    defaultTitle: "Besuch",
    rsvpLabel: "Ich bin da",
    attendeeVerb: "da",
  },
  handwerker: {
    label: "Handwerker",
    icon: "construct",
    defaultTitle: "Handwerker kommt",
    rsvpLabel: "Ich mache auf",
    attendeeVerb: "macht auf",
  },
  geburtstag: {
    label: "Geburtstag",
    icon: "gift",
    defaultTitle: "Geburtstag",
    rsvpLabel: "Bin dabei",
    attendeeVerb: "dabei",
  },
};

export const EVENT_KIND_ORDER: EventKind[] = ["termin", "wg_abend", "besuch", "handwerker", "geburtstag"];
