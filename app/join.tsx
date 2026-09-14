import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../src/lib/supabase";
import { useAuth } from "../src/lib/AuthProvider";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { colors } from "../src/lib/theme";
import { Button, ErrorText, Loading, Screen } from "../src/components/ui";
import type { Household } from "../src/types/database";

export const PENDING_INVITE_KEY = "pending_invite_code";

/**
 * Ziel des Einladungslinks (gemeinsamwohnen://join?code=ABC123).
 * Wer noch nicht angemeldet ist, landet beim Login — der Code wird
 * zwischengespeichert und danach im WG-Screen vorausgefüllt.
 */
export default function JoinScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { session, loading: authLoading } = useAuth();
  const { refresh, setActiveHousehold } = useHousehold();
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(true);

  useEffect(() => {
    if (authLoading) return;

    const run = async () => {
      if (!code) {
        setError("Dieser Einladungslink enthält keinen Code.");
        setWorking(false);
        return;
      }

      await AsyncStorage.setItem(PENDING_INVITE_KEY, code);

      if (!session) {
        router.replace("/(auth)/login");
        return;
      }

      const { data, error: joinError } = await supabase.rpc("join_household_by_code", { code });

      if (joinError || !data) {
        setError(joinError?.message ?? "Einladungscode nicht gefunden");
        setWorking(false);
        return;
      }

      await AsyncStorage.removeItem(PENDING_INVITE_KEY);
      await refresh();
      setActiveHousehold(data as Household);
      // Hat der Gründer schon einen Platz vorbereitet, dort übernehmen
      router.replace("/claim");
    };

    run();
  }, [authLoading, session, code, refresh, setActiveHousehold]);

  if (working) return <Loading />;

  return (
    <Screen>
      <View style={styles.content}>
        <Text style={styles.title}>Beitritt nicht möglich</Text>
        {error && <ErrorText>{error}</ErrorText>}
        <Button title="Zur WG-Auswahl" onPress={() => router.replace("/(auth)/household")} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 14, justifyContent: "center", flex: 1 },
  title: { fontSize: 20, fontWeight: "700", color: colors.text, textAlign: "center" },
});
