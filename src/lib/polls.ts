import { addDays, formatShort, todayISO } from "./dates";
import type { PollVote } from "../types/database";

export const MAX_POLL_OPTIONS = 10;

/** Antworten für „Wann passt es euch?": die nächsten sieben Tage ab morgen */
export function nextDaysOptions(count = 7): string[] {
  return Array.from({ length: count }, (_, index) => formatShort(addDays(todayISO(), index + 1)));
}

/** Wer hat was gewählt — Stimmen ohne Auswahl zählen nicht */
export function tallyPoll(optionCount: number, votes: PollVote[]) {
  const votersByOption: string[][] = Array.from({ length: optionCount }, () => []);
  const voters = new Set<string>();

  for (const vote of votes) {
    if (vote.choices.length === 0) continue;
    voters.add(vote.user_id);
    for (const choice of vote.choices) votersByOption[choice]?.push(vote.user_id);
  }

  return { votersByOption, voters };
}

// Nach dem Absenden einer Umfrage soll der Entwurf aus dem Chat-Eingabefeld
// verschwinden, beim Abbrechen aber stehen bleiben. Einen Rückgabewert über die
// Navigation gibt es nicht, deshalb diese kleine Brücke.
let pollSent = false;

export function markPollSent() {
  pollSent = true;
}

export function consumePollSent(): boolean {
  const sent = pollSent;
  pollSent = false;
  return sent;
}
