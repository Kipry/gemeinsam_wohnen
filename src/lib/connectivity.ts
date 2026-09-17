import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

/**
 * Ob die App gerade den Server erreicht — abgeleitet aus echten Anfragen statt
 * aus dem WLAN-/Mobilfunkstatus. Im Supermarkt zeigt das Handy oft Empfang an,
 * obwohl nichts durchkommt; zählen soll, ob Anfragen ankommen.
 */

// Ohne Zeitlimit hängt eine Anfrage bei schlechtem Empfang minutenlang
const REQUEST_TIMEOUT_MS = 10_000;
const UPLOAD_TIMEOUT_MS = 60_000;
const PROBE_INTERVAL_MS = 15_000;

let online = true;
const listeners = new Set<() => void>();
const reconnectListeners = new Set<() => void>();
let probe: (() => Promise<unknown>) | null = null;
let probeTimer: ReturnType<typeof setInterval> | null = null;

function setOnline(value: boolean) {
  if (online === value) return;
  online = value;
  listeners.forEach((listener) => listener());
  if (value) {
    stopProbe();
    reconnectListeners.forEach((listener) => listener());
  } else {
    startProbe();
  }
}

function startProbe() {
  if (probeTimer || !probe) return;
  probeTimer = setInterval(() => void probe?.(), PROBE_INTERVAL_MS);
}

function stopProbe() {
  if (!probeTimer) return;
  clearInterval(probeTimer);
  probeTimer = null;
}

export function isOnline() {
  return online;
}

/** Für Meldungen: ohne Netz verständlich statt „TypeError: Network request failed" */
export function describeError(error: { message: string } | null | undefined, status?: number) {
  if (status === 0) return "Keine Verbindung – versuch es nochmal, sobald du wieder Netz hast.";
  return error?.message ?? "Unbekannter Fehler";
}

export function useOnline() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isOnline,
    isOnline
  );
}

/** Wird aufgerufen, sobald nach einer Funkstille wieder etwas durchkommt */
export function onReconnect(listener: () => void) {
  reconnectListeners.add(listener);
  return () => {
    reconnectListeners.delete(listener);
  };
}

/** Leichte Anfrage, mit der offline regelmäßig geprüft wird, ob wieder Netz da ist */
export function configureProbe(check: () => Promise<unknown>) {
  probe = check;
}

// Zurück in der App: nicht bis zum nächsten Intervall warten
AppState.addEventListener("change", (state) => {
  if (state === "active" && !online) void probe?.();
});

export const fetchWithTimeout: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    url.includes("/storage/v1/") ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS
  );
  const outerSignal = init?.signal;
  outerSignal?.addEventListener?.("abort", () => controller.abort());

  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    setOnline(true);
    return response;
  } catch (error) {
    // Selbst abgebrochen ist kein Funkloch
    if (!outerSignal?.aborted) setOnline(false);
    throw error;
  } finally {
    clearTimeout(timer);
  }
};
