import { useEffect, useMemo, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { onReconnect } from "./connectivity";
import type { ShoppingItem } from "../types/database";

/**
 * Einkaufsliste ohne Netz. Im Laden ist der Empfang oft weg — abhaken und
 * ergänzen muss trotzdem gehen. Jede Änderung landet zuerst hier, wird sofort
 * angezeigt und geht in der richtigen Reihenfolge raus, sobald der Server
 * erreichbar ist. Alle Änderungen sind so gebaut, dass doppeltes Senden nicht
 * schadet (feste Werte statt „+1", eigene IDs für neue Artikel).
 */

type ItemChanges = Partial<
  Pick<ShoppingItem, "status" | "bought_by" | "bought_at" | "trip_id" | "quantity" | "category" | "deleted_at">
>;

export type ShoppingChange =
  | { kind: "insert"; rows: ShoppingItem[] }
  | { kind: "update"; itemIds: string[]; changes: ItemChanges };

type OpOwner = { userId: string; householdId: string };

export type NewShoppingOp = OpOwner & ShoppingChange;

export type ShoppingOp = NewShoppingOp & { id: string };

const STORAGE_KEY = "outbox:v1:shopping";

let ops: ShoppingOp[] = [];
let loadPromise: Promise<void> | null = null;
let currentUserId: string | null = null;
let flushing: Promise<void> | null = null;
let flushAgain = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function ensureLoaded() {
  loadPromise ??= AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      // Was in der Zwischenzeit schon eingereiht wurde, bleibt hinten dran
      ops = [...(raw ? (JSON.parse(raw) as ShoppingOp[]) : []), ...ops];
    })
    .catch(() => {})
    .finally(emit);
  return loadPromise;
}

function persist() {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ops)).catch(() => {});
}

/** UUID v4 — neue Artikel bekommen ihre ID schon auf dem Handy */
export function newId(): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function queueShoppingOp(op: NewShoppingOp) {
  ops = [...ops, { ...op, id: newId() } as ShoppingOp];
  void ensureLoaded().then(() => {
    persist();
    emit();
    void flushShoppingOps();
  });
  emit();
}

type Outcome = "sent" | "retry" | "rejected";

async function send(op: ShoppingOp): Promise<Outcome> {
  const { error, status } =
    op.kind === "insert"
      ? await supabase.from("shopping_items").insert(op.rows)
      : await supabase.from("shopping_items").update(op.changes).in("id", op.itemIds);

  if (!error) return "sent";
  // Kein Netz oder Zugang gerade nicht erneuerbar: später nochmal
  if (status === 0 || status === 401) return "retry";
  // Schon angekommen, nur die Antwort ging unterwegs verloren
  if (op.kind === "insert" && error.code === "23505") return "sent";
  console.error("Einkaufsliste: Änderung abgelehnt", error);
  return "rejected";
}

export function flushShoppingOps(): Promise<void> {
  if (flushing) {
    // Kam während des Sendens noch etwas dazu, gleich danach nochmal
    flushAgain = true;
    return flushing;
  }
  flushing = (async () => {
    await ensureLoaded();
    if (!currentUserId || ops.length === 0) return;

    // Ohne gültigen Zugang gingen Änderungen anonym raus — RLS würde sie still verwerfen
    const { data } = await supabase.auth.getSession();
    if (!data.session || data.session.user.id !== currentUserId) return;

    while (ops.length > 0) {
      const op = ops[0];
      let outcome: Outcome;
      try {
        outcome = op.userId === currentUserId ? await send(op) : "rejected";
      } catch {
        outcome = "retry";
      }
      if (outcome === "retry") return;
      ops = ops.filter((entry) => entry.id !== op.id);
      persist();
      emit();
    }
  })()
    .catch(() => {})
    .finally(() => {
      flushing = null;
      if (flushAgain) {
        flushAgain = false;
        void flushShoppingOps();
      }
    });
  return flushing;
}

/** Beim Abmelden: Unversendetes gehört zum alten Konto */
export async function clearShoppingOutbox() {
  ops = [];
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  emit();
}

/**
 * Vom Server geladene Liste plus alles, was noch unterwegs ist — sonst sprängen
 * offline abgehakte Artikel beim Neuladen kurz wieder zurück.
 */
export function applyPendingOps(items: ShoppingItem[], pending: ShoppingOp[]): ShoppingItem[] {
  let result = items;
  for (const op of pending) {
    if (op.kind === "insert") {
      const known = new Set(result.map((item) => item.id));
      result = [...result, ...op.rows.filter((row) => !known.has(row.id))];
    } else {
      const ids = new Set(op.itemIds);
      result = result.map((item) => (ids.has(item.id) ? { ...item, ...op.changes } : item));
    }
  }
  return result
    .filter((item) => item.deleted_at === null)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getOps() {
  return ops;
}

export function usePendingShoppingOps(householdId: string | undefined) {
  const all = useSyncExternalStore(subscribe, getOps, getOps);
  return useMemo(() => all.filter((op) => op.householdId === householdId), [all, householdId]);
}

/** Einmal oben in der App: sendet beim Start, nach Funklöchern und beim Zurückkehren in die App */
export function useShoppingOutboxSync(userId: string | null) {
  useEffect(() => {
    currentUserId = userId;
    if (userId) void flushShoppingOps();
  }, [userId]);

  useEffect(() => {
    const stopReconnect = onReconnect(() => void flushShoppingOps());
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void flushShoppingOps();
    });
    return () => {
      stopReconnect();
      subscription.remove();
    };
  }, []);
}
