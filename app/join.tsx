import { useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../src/lib/supabase";
import { describeError } from "../src/lib/connectivity";
import { useAuth } from "../src/lib/AuthProvider";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { makeStyles } from "../src/lib/theme";
import { Button, ErrorText, Loading, Screen } from "../src/components/ui";
import type { Household } from "../src/types/database";

export const PENDING_INVITE_KEY = "pending_invite_code";

type Failure = { message: string; retryable: boolean };

/**
 * Ziel des Einladungslinks (gemeinsamwohnen://join?code=ABC123).
 * Wer noch nicht angemeldet ist, landet beim Login — der Code wird
 * zwischengespeichert und danach im WG-Screen vorausgefüllt.
 */
export default function JoinScreen() {
  const styles = useStyles();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { session, loading: authLoading } = useAuth();
  const { households, loading: householdsLoading, refresh, setActiveHousehold } = useHousehold();
  const [failure, setFailure] = useState<Failure | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Der Effekt läuft bei jedem Neuaufbau des WG-Kontexts erneut — beitreten nur einmal pro Versuch
  const startedAttempt = useRef<number | null>(null);

  useEffect(() => {
    if (authLoading || (session && householdsLoading)) return;
    if (startedAttempt.current === attempt) return;
    startedAttempt.current = attempt;

    const run = async () => {
      const normalized = (code ?? "").trim().toUpperCase();
      if (!normalized) {
        setFailure({ message: "Dieser Einladungslink enthält keinen Code.", retryable: false });
        return;
      }

      // Schon Mitglied: in diese WG wechseln — nicht beitreten und keine Platz-Auswahl zeigen
      const existing = households.find((household) => household.invite_code === normalized);
      if (session && existing) {
        await AsyncStorage.removeItem(PENDING_INVITE_KEY);
        setActiveHousehold(existing);
        router.replace("/(tabs)/tasks");
        return;
      }

      await AsyncStorage.setItem(PENDING_INVITE_KEY, normalized);

      if (!session) {
        router.replace("/(auth)/login");
        return;
      }

      const { data, error, status } = await supabase.rpc("join_household_by_code", { code: normalized });

      if (error || !data) {
        setFailure({
          message: error ? describeError(error, status) : "Einladungscode nicht gefunden",
          retryable: status === 0,
        });
        return;
      }

      await AsyncStorage.removeItem(PENDING_INVITE_KEY);
      await refresh();
      setActiveHousehold(data as Household);
      // Hat der Gründer schon einen Platz vorbereitet, dort übernehmen
      router.replace("/claim");
    };

    run();
  }, [attempt, authLoading, session, householdsLoading, households, code, refresh, setActiveHousehold]);

  if (!failure) return <Loading />;

  const hasHousehold = households.length > 0;

  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace(hasHousehold ? "/(tabs)/tasks" : "/(auth)/household");
  };

  const retry = () => {
    setFailure(null);
    setAttempt((count) => count + 1);
  };

  return (
    <Screen>
      <View style={styles.content}>
        <Text style={styles.title}>Beitritt nicht möglich</Text>
        <ErrorText>{failure.message}</ErrorText>
        {failure.retryable && <Button title="Nochmal versuchen" onPress={retry} />}
        <Button
          title={hasHousehold ? "Zurück zur WG" : "Code von Hand eingeben"}
          variant={failure.retryable ? "secondary" : "primary"}
          onPress={hasHousehold ? leave : () => router.replace("/(auth)/household")}
        />
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  content: { padding: 24, gap: 14, justifyContent: "center", flex: 1 },
  title: { fontSize: 20, fontWeight: "700", color: colors.text, textAlign: "center" },
}));
