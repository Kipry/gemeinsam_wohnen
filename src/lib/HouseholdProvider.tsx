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

  const refresh = useCallback(async () => {
    if (!session) {
      setHouseholds([]);
      setActiveHouseholdState(null);
      setLoading(false);
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
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setActiveHousehold = (household: Household) => {
    setActiveHouseholdState(household);
    AsyncStorage.setItem(ACTIVE_HOUSEHOLD_KEY, household.id);
  };

  return (
    <HouseholdContext.Provider
      value={{ households, activeHousehold, loading, setActiveHousehold, refresh }}
    >
      {children}
    </HouseholdContext.Provider>
  );
}

export function useHousehold() {
  return useContext(HouseholdContext);
}
