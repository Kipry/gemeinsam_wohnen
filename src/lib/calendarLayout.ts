export type SpanItem = {
  id: string;
  kind: "event" | "absence";
  /** ISO-Datum, inklusive */
  start: string;
  /** ISO-Datum, inklusive */
  end: string;
  label: string;
};

export type Segment = SpanItem & {
  lane: number;
  startCol: number;
  endCol: number;
  /** Eintrag hat schon in der Vorwoche begonnen — linke Kante bleibt gerade */
  continuesLeft: boolean;
  /** Eintrag läuft in die nächste Woche weiter — rechte Kante bleibt gerade */
  continuesRight: boolean;
};

export type WeekLayout = {
  segments: Segment[];
  laneCount: number;
  /** Anzahl ausgeblendeter Einträge pro Wochentag (Spalte 0–6) */
  hidden: number[];
};

/**
 * Verteilt die Einträge einer Kalenderwoche auf Spuren, damit sich
 * mehrtägige Balken nicht überdecken. Ältere und längere Einträge
 * bekommen die oberen Spuren, damit ein Urlaub nicht zwischen zwei
 * kurzen Terminen hin- und herspringt.
 */
export function layoutWeek(items: SpanItem[], weekDays: string[], maxLanes: number): WeekLayout {
  const weekStart = weekDays[0];
  const weekEnd = weekDays[weekDays.length - 1];

  const candidates = items
    .filter((item) => item.start <= weekEnd && item.end >= weekStart)
    .map((item) => {
      const visibleStart = item.start < weekStart ? weekStart : item.start;
      const visibleEnd = item.end > weekEnd ? weekEnd : item.end;
      return {
        ...item,
        startCol: weekDays.indexOf(visibleStart),
        endCol: weekDays.indexOf(visibleEnd),
        continuesLeft: item.start < weekStart,
        continuesRight: item.end > weekEnd,
      };
    })
    .sort(
      (a, b) =>
        a.startCol - b.startCol ||
        b.endCol - b.startCol - (a.endCol - a.startCol) ||
        a.id.localeCompare(b.id)
    );

  const laneEnds: number[] = [];
  const segments: Segment[] = [];
  const hidden = new Array(weekDays.length).fill(0);

  for (const candidate of candidates) {
    let lane = laneEnds.findIndex((end) => end < candidate.startCol);

    if (lane === -1 && laneEnds.length < maxLanes) {
      lane = laneEnds.length;
      laneEnds.push(-1);
    }

    if (lane === -1) {
      for (let col = candidate.startCol; col <= candidate.endCol; col++) hidden[col] += 1;
      continue;
    }

    laneEnds[lane] = candidate.endCol;
    segments.push({ ...candidate, lane });
  }

  return { segments, laneCount: laneEnds.length, hidden };
}
