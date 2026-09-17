import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { configureProbe, fetchWithTimeout, onReconnect } from "./connectivity";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in your Supabase project values."
  );
}

let signedIn = false;

/** Setzt der AuthProvider: Ab jetzt müssen Datenanfragen mit Nutzer-Zugang laufen */
export function setSignedIn(value: boolean) {
  signedIn = value;
}

/**
 * Kurz nach einem Funkloch ist der abgelaufene Zugang oft noch nicht erneuert.
 * supabase-js schickt Anfragen dann nur mit dem App-Schlüssel — und die Datenbank
 * antwortet wegen RLS mit leeren Listen statt mit einem Fehler. Die App würde
 * ihren gespeicherten Stand damit überschreiben. Solche Anfragen scheitern hier
 * lieber wie ohne Netz; nach der Erneuerung geht es normal weiter.
 */
const guardedFetch: typeof fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (signedIn && /\/(rest|storage|functions)\/v1\//.test(url)) {
    const headers = new Headers(init?.headers);
    const authorization = headers.get("Authorization");
    if (!authorization || authorization === `Bearer ${headers.get("apikey")}`) {
      return Promise.reject(new TypeError("Network request failed (Zugang noch nicht erneuert)"));
    }
  }
  return fetchWithTimeout(input, init);
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: { fetch: guardedFetch },
});

/** Unter diesem Schlüssel legt supabase-js die Sitzung ab (Standardname) */
export const authStorageKey = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;

configureProbe(() =>
  fetchWithTimeout(`${supabaseUrl}/auth/v1/health`, { headers: { apikey: supabaseAnonKey } }).catch(() => {})
);

// supabase-js merkt sich eine gescheiterte Erneuerung 60 Sekunden lang und
// versucht es in der Zeit nicht nochmal. Nach einem Funkloch soll es sofort
// wieder gehen. (Internes Feld — fehlt es in einer neuen Version, dauert es
// nur bis zu einer Minute länger.)
onReconnect(() => {
  (supabase.auth as unknown as { lastRefreshFailure: unknown }).lastRefreshFailure = null;
});
