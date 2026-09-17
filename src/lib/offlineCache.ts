import { useCallback, useEffect, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "./AuthProvider";

/**
 * Letzter geladener Stand je Bildschirm auf dem Gerät. Ohne Netz zeigt die App
 * ihn an, statt leerer Listen; mit Netz wird er beim nächsten Laden ersetzt.
 * Je Konto getrennt, damit auf einem geteilten Gerät nichts durcheinandergerät.
 */

const PREFIX = "cache:v1:";

export async function readCache<T>(userId: string, key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(`${PREFIX}${userId}:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeCache(userId: string, key: string, value: unknown) {
  AsyncStorage.setItem(`${PREFIX}${userId}:${key}`, JSON.stringify(value)).catch(() => {});
}

/** Beim Abmelden: nichts vom Konto bleibt auf dem Gerät zurück */
export async function clearCache() {
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys.filter((key) => key.startsWith(PREFIX)));
}

/**
 * Stellt beim Öffnen den gespeicherten Stand wieder her und gibt eine Funktion
 * zurück, mit der frisch geladene Daten gespeichert werden. Kommt das Netz dem
 * Speicher zuvor, bleibt der frische Stand stehen.
 */
export function useOfflineSnapshot<T>(key: string | null, restore: (snapshot: T) => void) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const restoreRef = useRef(restore);
  const freshRef = useRef(false);

  useEffect(() => {
    restoreRef.current = restore;
  });

  useEffect(() => {
    freshRef.current = false;
    if (!key || !userId) return;
    let active = true;
    readCache<T>(userId, key).then((snapshot) => {
      if (active && snapshot && !freshRef.current) restoreRef.current(snapshot);
    });
    return () => {
      active = false;
    };
  }, [key, userId]);

  return useCallback(
    (snapshot: T) => {
      freshRef.current = true;
      if (key && userId) writeCache(userId, key, snapshot);
    },
    [key, userId]
  );
}
