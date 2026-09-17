import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isAuthRetryableFetchError, type Session } from "@supabase/supabase-js";
import { authStorageKey, setSignedIn, supabase } from "./supabase";

type AuthContextValue = {
  session: Session | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue>({ session: null, loading: true });

async function readStoredSession(): Promise<Session | null> {
  try {
    const raw = await AsyncStorage.getItem(authStorageKey);
    const stored = raw ? (JSON.parse(raw) as Session) : null;
    return stored?.user?.id && stored.refresh_token ? stored : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    // Hat supabase-js entschieden, zählt nur noch das
    let settled = false;

    const update = (next: Session | null) => {
      // Sofort, nicht erst nach dem nächsten Rendern — die ersten Anfragen laufen schon
      setSignedIn(next !== null);
      setSession(next);
    };

    // Ohne Netz kann getSession() einen abgelaufenen Zugang nicht erneuern, versucht
    // es rund 25 Sekunden und meldet dann „keine Sitzung" — die App landete beim
    // Login. Die gespeicherte Sitzung reicht aber, um den letzten Stand zu zeigen;
    // erneuert wird sie, sobald wieder Netz da ist.
    readStoredSession().then((stored) => {
      if (!active || settled || !stored) return;
      update(stored);
      setLoading(false);
    });

    supabase.auth.getSession().then(async ({ data, error }) => {
      if (!active) return;
      let next = data.session;
      // Funkloch statt Abmeldung: bei der gespeicherten Sitzung bleiben
      if (!next && isAuthRetryableFetchError(error)) next = await readStoredSession();
      if (!active) return;
      settled = true;
      update(next);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (newSession) update(newSession);
      // Ohne Netz meldet der Start „keine Sitzung"; abgemeldet ist erst, wer SIGNED_OUT bekommt
      else if (event === "SIGNED_OUT") update(null);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={{ session, loading }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
