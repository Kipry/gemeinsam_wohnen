export type ReviewExpense = {
  amount_cents: number;
  category: string | null;
  paid_by: string;
  expense_shares: { user_id: string; share_cents: number }[];
};

export type ReviewChore = {
  completed_by: string | null;
  due_date: string;
  completed_at: string | null;
  tasks: { points: number } | null;
};

export type ExpenseSummary = {
  totalCents: number;
  /** absteigend nach Betrag */
  byCategory: { category: string; cents: number }[];
  byPerson: Record<string, { paidCents: number; shareCents: number }>;
};

export type ChoreSummary = {
  count: number;
  points: number;
  byPerson: Record<string, { points: number; count: number; onTime: number }>;
};

export function summarizeExpenses(expenses: ReviewExpense[], memberIds: string[]): ExpenseSummary {
  const byPerson: ExpenseSummary["byPerson"] = {};
  for (const id of memberIds) byPerson[id] = { paidCents: 0, shareCents: 0 };

  const categories = new Map<string, number>();
  let totalCents = 0;

  for (const expense of expenses) {
    totalCents += expense.amount_cents;

    const category = expense.category ?? "Sonstiges";
    categories.set(category, (categories.get(category) ?? 0) + expense.amount_cents);

    // Personen, die inzwischen ausgezogen sind, trotzdem mitzählen
    byPerson[expense.paid_by] ??= { paidCents: 0, shareCents: 0 };
    byPerson[expense.paid_by].paidCents += expense.amount_cents;

    for (const share of expense.expense_shares) {
      byPerson[share.user_id] ??= { paidCents: 0, shareCents: 0 };
      byPerson[share.user_id].shareCents += share.share_cents;
    }
  }

  return {
    totalCents,
    byCategory: [...categories.entries()]
      .map(([category, cents]) => ({ category, cents }))
      .sort((a, b) => b.cents - a.cents),
    byPerson,
  };
}

export function summarizeChores(chores: ReviewChore[], memberIds: string[]): ChoreSummary {
  const byPerson: ChoreSummary["byPerson"] = {};
  for (const id of memberIds) byPerson[id] = { points: 0, count: 0, onTime: 0 };

  let count = 0;
  let points = 0;

  for (const chore of chores) {
    if (!chore.completed_by) continue;
    const value = chore.tasks?.points ?? 0;
    count += 1;
    points += value;

    byPerson[chore.completed_by] ??= { points: 0, count: 0, onTime: 0 };
    const person = byPerson[chore.completed_by];
    person.points += value;
    person.count += 1;
    // Pünktlich = spätestens am Fälligkeitstag abgehakt (lokales Datum)
    if (chore.completed_at && localDate(chore.completed_at) <= chore.due_date) {
      person.onTime += 1;
    }
  }

  return { count, points, byPerson };
}

/** Veränderung in Prozent, gerundet. null, wenn es im Vormonat nichts zu vergleichen gab. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function localDate(timestamp: string): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
