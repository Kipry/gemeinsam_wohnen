import { useEffect, useState } from "react";
import { Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { describeError } from "./connectivity";
import { hapticSuccess } from "./haptics";
import { todayISO } from "./dates";
import type { Household } from "../types/database";

/**
 * Putzplan neu starten: Punkte zählen ab jetzt für alle von null, überfällige
 * Aufgaben von vorher fallen weg. Fragt vorher nach und sagt, was passiert.
 */
export async function confirmChoreRestart(householdId: string, onDone: () => void) {
  const { count } = await supabase
    .from("task_occurrences")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId)
    .eq("status", "open")
    .lt("due_date", todayISO());
  const overdue = count ?? 0;

  const message = [
    `Punkte und „pünktlich" zählen ab jetzt für alle von null.`,
    overdue > 0
      ? `${overdue} überfällige ${overdue === 1 ? "Aufgabe fällt" : "Aufgaben fallen"} weg.`
      : null,
    "Im Chat sehen alle, dass du neu gestartet hast. Der Monatsrückblick bleibt, wie er ist.",
  ]
    .filter(Boolean)
    .join("\n\n");

  Alert.alert("Putzplan neu starten?", message, [
    { text: "Abbrechen", style: "cancel" },
    {
      text: "Neu starten",
      style: "destructive",
      onPress: async () => {
        const { error, status } = await supabase.rpc("restart_chore_stats", { p_household_id: householdId });
        if (error) {
          Alert.alert("Nicht neu gestartet", describeError(error, status));
          return;
        }
        hapticSuccess();
        onDone();
      },
    },
  ]);
}

/** Ab wann die Statistik zählt: letzter Neustart, sonst Gründung der WG */
export function statsCountingSince(household: Household): string {
  return household.stats_since ?? household.created_at;
}

/**
 * Der passende Moment für einen Neustart: Der letzte Platzhalter wurde gerade
 * übernommen, alle sind dabei — und seitdem wurde noch nicht neu gestartet.
 */
export function useRestartSuggestion(
  household: Household | null,
  openPlaceholders: number,
  placeholdersLoading: boolean
) {
  const householdId = household?.id;
  const [lastClaimedAt, setLastClaimedAt] = useState<string | null>(null);
  // undefined: noch nicht gelesen — so lange nichts zeigen
  const [dismissedFor, setDismissedFor] = useState<string | null | undefined>(undefined);
  const storageKey = `restart_prompt_dismissed:${householdId}`;

  useEffect(() => {
    if (!householdId) return;
    let active = true;
    supabase
      .from("household_placeholders")
      .select("claimed_at")
      .eq("household_id", householdId)
      .not("claimed_at", "is", null)
      .order("claimed_at", { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (active && !error) setLastClaimedAt((data?.[0]?.claimed_at as string | undefined) ?? null);
      });
    AsyncStorage.getItem(storageKey)
      .then((value) => active && setDismissedFor(value))
      .catch(() => active && setDismissedFor(null));
    return () => {
      active = false;
    };
    // Neu prüfen, sobald jemand einen Platz übernommen hat
  }, [householdId, storageKey, openPlaceholders]);

  const show =
    !!household &&
    !placeholdersLoading &&
    openPlaceholders === 0 &&
    lastClaimedAt !== null &&
    dismissedFor !== undefined &&
    dismissedFor !== lastClaimedAt &&
    Date.parse(lastClaimedAt) > Date.parse(statsCountingSince(household));

  const dismiss = () => {
    if (!lastClaimedAt) return;
    setDismissedFor(lastClaimedAt);
    AsyncStorage.setItem(storageKey, lastClaimedAt).catch(() => {});
  };

  return { show, dismiss };
}
