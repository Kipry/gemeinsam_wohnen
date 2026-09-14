const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const WEEKDAYS_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/** Kopfzeile des Monatsrasters, Montag zuerst */
export const WEEKDAY_HEADER = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** "September 2026" — month ist 0-basiert wie bei Date */
export function formatMonth(year: number, month: number): string {
  return `${MONTHS[month]} ${year}`;
}

/** "Samstag, 19. September" */
export function formatLong(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  return `${WEEKDAYS_LONG[date.getDay()]}, ${date.getDate()}. ${MONTHS[date.getMonth()]}`;
}

/** "18:00:00" oder "18:00" → "18:00" */
export function formatTime(time: string | null): string | null {
  return time ? time.slice(0, 5) : null;
}

/**
 * 42 Tage (6 Wochen, Montag zuerst) für die Monatsansicht — inklusive der
 * angeschnittenen Tage aus Vor- und Folgemonat, damit das Raster nie springt.
 */
export function monthGrid(year: number, month: number): string[] {
  const first = toISO(new Date(year, month, 1, 12));
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

/** Liegt das Datum im angegebenen Monat? */
export function isInMonth(iso: string, year: number, month: number): boolean {
  const date = new Date(`${iso}T12:00:00`);
  return date.getFullYear() === year && date.getMonth() === month;
}

export function todayISO(): string {
  return toISO(new Date());
}

export function toISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return toISO(date);
}

/** "Sa, 20.09." */
export function formatShort(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${WEEKDAYS[date.getDay()]}, ${day}.${month}.`;
}

/** Zeitraum lesbar: "Sa, 20.09. – So, 21.09." oder nur ein Tag. */
export function formatRange(startISO: string, endISO: string): string {
  return startISO === endISO ? formatShort(startISO) : `${formatShort(startISO)} – ${formatShort(endISO)}`;
}

/** Montag der Woche, in der das Datum liegt. */
export function startOfWeek(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  const offset = (date.getDay() + 6) % 7;
  return addDays(iso, -offset);
}

/** "Diese Woche", "Nächste Woche" oder "Woche ab Mo, 28.09." */
export function weekLabel(iso: string): string {
  const weekStart = startOfWeek(iso);
  const thisWeek = startOfWeek(todayISO());

  if (weekStart === thisWeek) return "Diese Woche";
  if (weekStart === addDays(thisWeek, 7)) return "Nächste Woche";
  return `Woche ab ${formatShort(weekStart)}`;
}

/** Das kommende Wochenende (Samstag bis Sonntag), heute eingeschlossen. */
export function comingWeekend(): { start: string; end: string } {
  const today = new Date();
  const daysUntilSaturday = (6 - today.getDay() + 7) % 7;
  const saturday = addDays(todayISO(), daysUntilSaturday);
  return { start: saturday, end: addDays(saturday, 1) };
}

/** Nächste Woche, Montag bis Sonntag. */
export function nextWeek(): { start: string; end: string } {
  const today = new Date();
  const daysUntilMonday = ((8 - today.getDay()) % 7) || 7;
  const monday = addDays(todayISO(), daysUntilMonday);
  return { start: monday, end: addDays(monday, 6) };
}
