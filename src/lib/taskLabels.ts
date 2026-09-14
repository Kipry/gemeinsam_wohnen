const WEEKDAY_ADVERBS = [
  "sonntags",
  "montags",
  "dienstags",
  "mittwochs",
  "donnerstags",
  "freitags",
  "samstags",
];

/** "jeden Tag", "jede Woche", "alle zwei Wochen", "alle 3 Tage" */
export function intervalLabel(days: number): string {
  if (days === 1) return "jeden Tag";
  if (days === 7) return "jede Woche";
  if (days === 14) return "alle zwei Wochen";
  if (days === 28) return "alle vier Wochen";
  if (days % 7 === 0) return `alle ${days / 7} Wochen`;
  return `alle ${days} Tage`;
}

/** "jede Woche · dienstags" — ohne festen Wochentag nur der Rhythmus */
export function rhythmLabel(intervalDays: number, weekday: number | null): string {
  const base = intervalLabel(intervalDays);
  return weekday === null ? base : `${base} · ${WEEKDAY_ADVERBS[weekday]}`;
}
