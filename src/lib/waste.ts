// Abholtermine der Mülltonnen — rein rechnerisch aus Rhythmus und Verschiebungen.
// Bewusst ohne Laufzeit-Importe, damit sich die Datumslogik direkt testen lässt.

export type WasteKind = "rest" | "papier" | "bio" | "gelb" | "sonstige";

export type WasteBinRule = {
  id: string;
  kind: WasteKind;
  label: string;
  /** Ein bekannter Abholtermin */
  first_date: string;
  interval_weeks: number;
};

export type WasteChange = {
  bin_id: string;
  original_date: string;
  /** null: Abholung fällt aus */
  new_date: string | null;
};

export type Collection<Bin extends WasteBinRule = WasteBinRule> = {
  bin: Bin;
  /** Tag, an dem abgeholt wird (bei Ausfall der Tag, an dem sie gewesen wäre) */
  date: string;
  /** Tag laut Rhythmus */
  originalDate: string;
  status: "planned" | "moved" | "cancelled";
};

export const WASTE_KINDS: { kind: WasteKind; label: string }[] = [
  { kind: "rest", label: "Restmüll" },
  { kind: "papier", label: "Papier" },
  { kind: "bio", label: "Bio" },
  { kind: "gelb", label: "Gelber Sack" },
  { kind: "sonstige", label: "Sonstiges" },
];

const KIND_ORDER: WasteKind[] = ["rest", "papier", "bio", "gelb", "sonstige"];
const WEEKDAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const WEEKDAY_ADVERBS = ["sonntags", "montags", "dienstags", "mittwochs", "donnerstags", "freitags", "samstags"];
const DAY_MS = 86_400_000;

// Tage seit 1970 in UTC — so erzeugt die Zeitumstellung keine halben Tage
function toDay(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function fromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function isPlannedDay(bin: Pick<WasteBinRule, "first_date" | "interval_weeks">, day: number): boolean {
  const period = 7 * bin.interval_weeks;
  return (((day - toDay(bin.first_date)) % period) + period) % period === 0;
}

/** Ist `iso` laut Rhythmus ein Abholtag dieser Tonne? (Verschiebungen nicht berücksichtigt) */
export function isCollectionDay(bin: Pick<WasteBinRule, "first_date" | "interval_weeks">, iso: string): boolean {
  return isPlannedDay(bin, toDay(iso));
}

/** 0 = Sonntag … 6 = Samstag */
export function weekdayOf(iso: string): number {
  return new Date(toDay(iso) * DAY_MS).getUTCDay();
}

/** Alle Abholungen von `from` bis `to` (beide inklusive), nach Tag und Tonnenart sortiert. */
export function collectionsBetween<Bin extends WasteBinRule>(
  bins: Bin[],
  changes: WasteChange[],
  from: string,
  to: string
): Collection<Bin>[] {
  const start = toDay(from);
  const end = toDay(to);
  const result: Collection<Bin>[] = [];

  for (const bin of bins) {
    const period = 7 * bin.interval_weeks;
    const anchor = toDay(bin.first_date);
    const binChanges = changes.filter((change) => change.bin_id === bin.id);

    for (let day = anchor + Math.ceil((start - anchor) / period) * period; day <= end; day += period) {
      const original = fromDay(day);
      const change = binChanges.find((entry) => entry.original_date === original);
      if (!change) {
        result.push({ bin, date: original, originalDate: original, status: "planned" });
      } else if (change.new_date === null) {
        result.push({ bin, date: original, originalDate: original, status: "cancelled" });
      }
      // Verschoben: erscheint am neuen Tag (siehe unten)
    }

    for (const change of binChanges) {
      if (!change.new_date || !isPlannedDay(bin, toDay(change.original_date))) continue;
      const moved = toDay(change.new_date);
      if (moved >= start && moved <= end) {
        result.push({ bin, date: change.new_date, originalDate: change.original_date, status: "moved" });
      }
    }
  }

  return result.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      KIND_ORDER.indexOf(a.bin.kind) - KIND_ORDER.indexOf(b.bin.kind) ||
      a.bin.label.localeCompare(b.bin.label)
  );
}

/** Nächste tatsächliche Abholung ab `today` (inklusive), ausgefallene übersprungen. */
export function nextCollection<Bin extends WasteBinRule>(
  bin: Bin,
  changes: WasteChange[],
  today: string
): Collection<Bin> | null {
  const horizon = fromDay(toDay(today) + 7 * bin.interval_weeks * 3 + 7);
  return (
    collectionsBetween([bin], changes, today, horizon).find((entry) => entry.status !== "cancelled") ?? null
  );
}

/** „jeden Freitag", „alle 2 Wochen freitags" */
export function rhythmText(bin: Pick<WasteBinRule, "first_date" | "interval_weeks">): string {
  const weekday = weekdayOf(bin.first_date);
  return bin.interval_weeks === 1
    ? `jeden ${WEEKDAY_NAMES[weekday]}`
    : `alle ${bin.interval_weeks} Wochen ${WEEKDAY_ADVERBS[weekday]}`;
}

/**
 * Die nächsten Tage mit diesem Wochentag ab heute — so viele, wie der Rhythmus
 * Wochen hat. Daraus wählt man „nächste Abholung", das legt die Phase fest.
 */
export function candidateDates(weekday: number, intervalWeeks: number, today: string): string[] {
  const start = toDay(today);
  const offset = (weekday - new Date(start * DAY_MS).getUTCDay() + 7) % 7;
  return Array.from({ length: intervalWeeks }, (_, index) => fromDay(start + offset + index * 7));
}
