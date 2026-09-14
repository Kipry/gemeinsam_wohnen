// Wird eine Aufgabe auf ihrem eigenen Bildschirm erledigt, zeigt der Putzplan
// danach die gewohnte „Rückgängig"-Leiste — dafür dieser kleine Kanal.

export type ChoreCompleted = { occurrenceId: string; title: string };

const listeners = new Set<(event: ChoreCompleted) => void>();

export function onChoreCompleted(listener: (event: ChoreCompleted) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitChoreCompleted(event: ChoreCompleted) {
  listeners.forEach((listener) => listener(event));
}
