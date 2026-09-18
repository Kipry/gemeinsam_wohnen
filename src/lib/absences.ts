import { addDays } from "./dates";
import type { Absence } from "../types/database";

/**
 * Eine zusammenhängende Abwesenheit einer Person. Doppelt gespeicherte,
 * überlappende oder direkt aneinander anschließende Einträge ergeben einen
 * Block — sonst stand dieselbe Person zweimal untereinander im Kalender und
 * belegte zwei der drei Balken-Spuren, sodass andere Abwesenheiten im
 * Monatsraster hinter „+1" verschwanden.
 */
export type AbsenceBlock = {
  /** Id des ersten Eintrags — stabil genug als Schlüssel */
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  note: string | null;
  entries: Absence[];
};

export function mergeAbsences(absences: Absence[]): AbsenceBlock[] {
  const sorted = [...absences].sort(
    (a, b) =>
      a.user_id.localeCompare(b.user_id) ||
      a.start_date.localeCompare(b.start_date) ||
      a.created_at.localeCompare(b.created_at)
  );

  const blocks: AbsenceBlock[] = [];
  for (const absence of sorted) {
    const last = blocks[blocks.length - 1];
    if (last && last.user_id === absence.user_id && absence.start_date <= addDays(last.end_date, 1)) {
      if (absence.end_date > last.end_date) last.end_date = absence.end_date;
      last.entries.push(absence);
      continue;
    }
    blocks.push({
      id: absence.id,
      user_id: absence.user_id,
      start_date: absence.start_date,
      end_date: absence.end_date,
      note: null,
      entries: [absence],
    });
  }

  for (const block of blocks) {
    const notes = block.entries
      .map((entry) => entry.note?.trim())
      .filter((note): note is string => Boolean(note));
    block.note = [...new Set(notes)].join(" · ") || null;
  }

  return blocks;
}
