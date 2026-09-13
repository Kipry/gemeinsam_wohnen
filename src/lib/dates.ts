const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

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
