import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import type { Household } from "../types/database";
import { useAuth } from "./AuthProvider";

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
  const [households, setHouseholds] = useState<Household[]>([]);
  const [activeHousehold, setActiveHouseholdState] = useState<Household | null>(null);
  const [loading, setLoading] = useState(true);
  // Für wen zuletzt geladen wurde. Wechselt die Sitzung, gilt das sofort im
  // selben Render als "lädt" — nicht erst, wenn der Effekt neu gelaufen ist.
  // Sonst sieht ein direkt geöffneter Tab kurz "keine WG" und leitet fälschlich
  // zur WG-Einrichtung um.
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined);
  const currentUserId = session?.user.id ?? null;

  const refresh = useCallback(async () => {
    if (!session) {
      setHouseholds([]);
      setActiveHouseholdState(null);
      setLoading(false);
      setLoadedFor(null);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .from("household_members")
      .select("households(*)")
      .eq("user_id", session.user.id);

    if (error) {
      console.error("Failed to load households", error);
      setLoading(false);
      setLoadedFor(session.user.id);
      return;
    }

    const loaded = ((data ?? []) as unknown as { households: Household | null }[])
      .map((row) => row.households)
      .filter((h): h is Household => h !== null);
    setHouseholds(loaded);

    const storedId = await AsyncStorage.getItem(ACTIVE_HOUSEHOLD_KEY);
    const restored = loaded.find((h) => h.id === storedId);
    setActiveHouseholdState(restored ?? loaded[0] ?? null);
    setLoading(false);
    setLoadedFor(session.user.id);
  }, [session]);

  const effectiveLoading = loading || loadedFor !== currentUserId;

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setActiveHousehold = (household: Household) => {
    setActiveHouseholdState(household);
    AsyncStorage.setItem(ACTIVE_HOUSEHOLD_KEY, household.id);
  };

  return (
    <HouseholdContext.Provider
      value={{ households, activeHousehold, loading: effectiveLoading, setActiveHousehold, refresh }}
    >
      {children}
    </HouseholdContext.Provider>
  );
}

export function useHousehold() {
  return useContext(HouseholdContext);
}
