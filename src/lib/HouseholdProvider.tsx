import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import type { Household } from "../types/database";
import { useAuth } from "./AuthProvider";
import { onReconnect } from "./connectivity";
import { readCache, writeCache } from "./offlineCache";

const ACTIVE_HOUSEHOLD_KEY = "active_household_id";

type HouseholdContextValue = {
  households: Household[];
  activeHousehold: Household | null;
  loading: boolean;
  setActiveHousehold: (household: Household) => void;
  refresh: () => Promise<void>;
};

const HouseholdContext = createContext<HouseholdContextValue>({
  households: [],
  activeHousehold: null,
  loading: true,
  setActiveHousehold: () => {},
  refresh: async () => {},
});

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  // Nur am Konto hängen, nicht am Sitzungsobjekt: das wechselt bei jeder
  // Token-Erneuerung, und jedes Neuladen hier ließ kurz die ganze App verschwinden
  const userId = session?.user.id ?? null;
  const [households, setHouseholds] = useState<Household[]>([]);
  const [activeHousehold, setActiveHouseholdState] = useState<Household | null>(null);
  // Für wen der angezeigte Stand gilt. Wechselt das Konto, gilt das sofort im
  // selben Render als "lädt" — nicht erst, wenn der Effekt neu gelaufen ist.
  // Sonst sieht ein direkt geöffneter Tab kurz "keine WG" und leitet fälschlich
  // zur WG-Einrichtung um.
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined);
  // Frische Daten aus dem Netz dürfen nicht vom langsameren Gerätespeicher überschrieben werden
  const freshFor = useRef<string | null>(null);

  const apply = useCallback(async (list: Household[]) => {
    setHouseholds(list);
    const storedId = await AsyncStorage.getItem(ACTIVE_HOUSEHOLD_KEY);
    setActiveHouseholdState(
      (current) =>
        list.find((h) => h.id === current?.id) ?? list.find((h) => h.id === storedId) ?? list[0] ?? null
    );
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) {
      setHouseholds([]);
      setActiveHouseholdState(null);
      setLoadedFor(null);
      return;
    }

    const { data, error } = await supabase
      .from("household_members")
      .select("households(*)")
      .eq("user_id", userId);

    if (error) {
      console.error("Failed to load households", error);
      // Ohne Netz: beim gespeicherten Stand bleiben
      if (freshFor.current !== userId) {
        const cached = await readCache<Household[]>(userId, "households");
        if (cached) await apply(cached);
      }
      setLoadedFor(userId);
      return;
    }

    const loaded = ((data ?? []) as unknown as { households: Household | null }[])
      .map((row) => row.households)
      .filter((h): h is Household => h !== null);
    freshFor.current = userId;
    writeCache(userId, "households", loaded);
    await apply(loaded);
    setLoadedFor(userId);
  }, [userId, apply]);

  // Gespeicherten Stand sofort zeigen — im Funkloch kann das Netz lange brauchen
  useEffect(() => {
    if (!userId) return;
    let active = true;
    readCache<Household[]>(userId, "households").then(async (cached) => {
      if (!active || !cached || freshFor.current === userId) return;
      await apply(cached);
      if (active && freshFor.current !== userId) setLoadedFor(userId);
    });
    return () => {
      active = false;
    };
  }, [userId, apply]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => onReconnect(() => void refresh()), [refresh]);

  const setActiveHousehold = (household: Household) => {
    setActiveHouseholdState(household);
    AsyncStorage.setItem(ACTIVE_HOUSEHOLD_KEY, household.id);
  };

  return (
    <HouseholdContext.Provider
      value={{ households, activeHousehold, loading: loadedFor !== userId, setActiveHousehold, refresh }}
    >
      {children}
    </HouseholdContext.Provider>
  );
}

export function useHousehold() {
  return useContext(HouseholdContext);
}
