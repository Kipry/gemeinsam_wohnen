import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { onReconnect } from "./connectivity";
import { useOfflineSnapshot } from "./offlineCache";

/**
 * Stammdaten einer WG (Mitbewohner, Teams, Platzhalter).
 *
 * Bisher lud jede dieser Listen nur beim ersten Aufbau des Bildschirms. Tabs
 * bleiben aber geöffnet — wer danach ein Team anlegte, sah im Putzplan
 * dauerhaft „Team ?". Deshalb: gespeicherter Stand zuerst, neu laden beim
 * Zurückkehren auf den Bildschirm und nach einem Funkloch.
 *
 * `fetcher` muss stabil sein (Funktion außerhalb der Komponente) und bei
 * Netzfehlern null liefern — dann bleibt der bisherige Stand stehen.
 */
export function useHouseholdResource<T>(
  householdId: string | undefined,
  cacheKey: string,
  fetcher: (householdId: string) => Promise<T | null>,
  empty: T
) {
  const [data, setData] = useState<T>(empty);
  const [loading, setLoading] = useState(true);
  const emptyRef = useRef(empty);

  const saveSnapshot = useOfflineSnapshot<T>(householdId ? `${cacheKey}:${householdId}` : null, (cached) => {
    setData(cached);
    setLoading(false);
  });

  const refresh = useCallback(async () => {
    if (!householdId) {
      setData(emptyRef.current);
      setLoading(false);
      return;
    }
    const result = await fetcher(householdId);
    if (result !== null) {
      setData(result);
      saveSnapshot(result);
    }
    setLoading(false);
  }, [householdId, fetcher, saveSnapshot]);

  // Direkt nach dem Laden nicht gleich nochmal — der Effekt unten läuft beim Aufbau mit
  const skipNextFocus = useRef(true);

  useEffect(() => {
    skipNextFocus.current = true;
    refresh();
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      if (skipNextFocus.current) {
        skipNextFocus.current = false;
        return;
      }
      refresh();
    }, [refresh])
  );

  useEffect(() => onReconnect(() => void refresh()), [refresh]);

  return { data, loading, refresh };
}
