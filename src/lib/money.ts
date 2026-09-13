export function formatCents(cents: number): string {
  return `${(cents / 100).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

/** 1234 → "12,34" — zum Vorbelegen von Eingabefeldern, ohne Währungszeichen. */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/** "12,34" oder "12.34" → 1234. Gibt null bei ungültiger Eingabe. */
export function parseAmountToCents(input: string): number | null {
  const normalized = input.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

/** Gleichmäßig aufteilen; Restcents gehen an die ersten Personen der Liste. */
export function splitEqually(totalCents: number, userIds: string[]): Record<string, number> {
  const shares: Record<string, number> = {};
  if (userIds.length === 0) return shares;

  const base = Math.floor(totalCents / userIds.length);
  let remainder = totalCents - base * userIds.length;

  for (const userId of userIds) {
    shares[userId] = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
  }
  return shares;
}

/**
 * Nach Gewichten aufteilen (z.B. 1, 1, 2 bei ungleich großen Zimmern).
 * Restcents gehen an die größten Nachkommaanteile, damit die Summe exakt
 * dem Betrag entspricht.
 */
export function splitByWeights(
  totalCents: number,
  weights: Record<string, number>
): Record<string, number> {
  const entries = Object.entries(weights).filter(([, weight]) => weight > 0);
  const weightSum = entries.reduce((sum, [, weight]) => sum + weight, 0);

  const shares: Record<string, number> = {};
  if (entries.length === 0 || weightSum <= 0) return shares;

  const exact = entries.map(([userId, weight]) => {
    const value = (totalCents * weight) / weightSum;
    return { userId, floor: Math.floor(value), remainder: value - Math.floor(value) };
  });

  let distributed = 0;
  for (const entry of exact) {
    shares[entry.userId] = entry.floor;
    distributed += entry.floor;
  }

  const leftover = totalCents - distributed;
  const byRemainder = [...exact].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < leftover; i++) {
    shares[byRemainder[i % byRemainder.length].userId] += 1;
  }

  return shares;
}

export type SuggestedTransfer = { from: string; to: string; amount_cents: number };

/**
 * Wer zahlt wem, um alle Salden auszugleichen — mit möglichst wenigen
 * Überweisungen (greedy: größter Schuldner zahlt an größten Gläubiger).
 */
export function suggestSettlements(
  balances: { user_id: string; net_cents: number }[]
): SuggestedTransfer[] {
  const debtors = balances
    .filter((b) => b.net_cents < 0)
    .map((b) => ({ user_id: b.user_id, amount: -b.net_cents }))
    .sort((a, b) => b.amount - a.amount);

  const creditors = balances
    .filter((b) => b.net_cents > 0)
    .map((b) => ({ user_id: b.user_id, amount: b.net_cents }))
    .sort((a, b) => b.amount - a.amount);

  const transfers: SuggestedTransfer[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);
    if (amount > 0) {
      transfers.push({ from: debtors[i].user_id, to: creditors[j].user_id, amount_cents: amount });
      debtors[i].amount -= amount;
      creditors[j].amount -= amount;
    }
    if (debtors[i].amount === 0) i += 1;
    if (creditors[j].amount === 0) j += 1;
  }

  return transfers;
}
