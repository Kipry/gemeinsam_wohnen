import { useEffect, useState, type ReactNode } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../src/lib/supabase";
import { useAuth } from "../src/lib/AuthProvider";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { makeStyles, useColors } from "../src/lib/theme";
import { formatCents } from "../src/lib/money";
import { signOutToLogin } from "../src/lib/signOut";
import { joinWithAnd } from "../src/lib/text";
import { Button, Card, ErrorText, Loading, Muted } from "../src/components/ui";

type Overview = {
  soloHouseholds: string[];
  openBalances: { name: string; netCents: number }[];
};

export default function DeleteAccountScreen() {
  const styles = useStyles();
  const { session } = useAuth();
  const { households } = useHousehold();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    const ids = households.map((household) => household.id);
    const nameOf = (id: string) => households.find((household) => household.id === id)?.name ?? "WG";

    Promise.all([
      supabase.from("household_members").select("household_id, user_id").in("household_id", ids),
      supabase
        .from("expense_balance_view")
        .select("household_id, net_cents")
        .eq("user_id", session.user.id)
        .in("household_id", ids),
    ]).then(([memberResult, balanceResult]) => {
      const soloHouseholds = ids
        .filter(
          (id) =>
            !(memberResult.data ?? []).some(
              (row) => row.household_id === id && row.user_id !== session.user.id
            )
        )
        .map(nameOf);

      // In Solo-WGs gibt es niemanden, dem etwas geschuldet wird
      const openBalances = (balanceResult.data ?? [])
        .filter((row) => row.net_cents !== 0 && !soloHouseholds.includes(nameOf(row.household_id)))
        .map((row) => ({ name: nameOf(row.household_id), netCents: row.net_cents }));

      setOverview({ soloHouseholds, openBalances });
    });
  }, [session, households]);

  if (!session || !overview) return <Loading />;

  const isAppleUser = (session.user.app_metadata?.providers ?? [session.user.app_metadata?.provider]).includes(
    "apple"
  );

  const deleteAccount = async () => {
    setError(null);
    setDeleting(true);

    // Apple-Konten bestätigen per Face ID — der dabei ausgestellte Code erlaubt
    // es, die Anmeldung mit Apple beim Löschen auch dort zu widerrufen.
    let appleAuthorizationCode: string | undefined;
    if (isAppleUser && Platform.OS === "ios") {
      try {
        const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
        appleAuthorizationCode = credential.authorizationCode ?? undefined;
      } catch (e: any) {
        if (e?.code === "ERR_REQUEST_CANCELED") {
          setDeleting(false);
          return;
        }
        // Ohne Code wird trotzdem gelöscht, nur nicht bei Apple widerrufen
      }
    }

    const { data, error: invokeError } = await supabase.functions.invoke("delete-account", {
      body: { appleAuthorizationCode },
    });

    if (invokeError || !data?.ok) {
      setDeleting(false);
      setError("Das Konto konnte nicht gelöscht werden. Versuch es gleich noch einmal.");
      return;
    }

    Alert.alert("Konto gelöscht", "Mach's gut! Deine Daten sind entfernt.");
    // Die Sitzung gibt es serverseitig nicht mehr — nur noch lokal aufräumen
    await signOutToLogin("local");
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={{ gap: 12 }}>
        <Text style={styles.heading}>Das passiert beim Löschen</Text>
        <Bullet icon="exit-outline">
          Du verlässt {households.length === 1 ? "deine WG" : "alle deine WGs"}. Deine Putz-Plätze werden
          unter den anderen neu verteilt.
        </Bullet>
        <Bullet icon="receipt-outline">
          Ausgaben und Rückzahlungen bleiben für die anderen erhalten — statt deines Namens steht dort
          „Ehemaliges Mitglied".
        </Bullet>
        <Bullet icon="trash-outline">
          Deine Chat-Nachrichten, Abwesenheiten und Terminzusagen werden gelöscht.
        </Bullet>
        {overview.soloHouseholds.length > 0 && (
          <Bullet icon="home-outline">
            {joinWithAnd(overview.soloHouseholds)}{" "}
            {overview.soloHouseholds.length === 1 ? "wird" : "werden"} komplett gelöscht, weil du dort
            allein bist — samt Belegfotos.
          </Bullet>
        )}
      </Card>

      {overview.openBalances.length > 0 && (
        <Card style={styles.warningCard}>
          <Text style={styles.heading}>Noch offene Beträge</Text>
          {overview.openBalances.map((balance) => (
            <Text key={balance.name} style={styles.balanceRow}>
              {balance.name}:{" "}
              {balance.netCents > 0
                ? `Du bekommst noch ${formatCents(balance.netCents)}`
                : `Du schuldest noch ${formatCents(-balance.netCents)}`}
            </Text>
          ))}
          <Muted>Am besten gleicht ihr das vorher aus — danach geht es nur noch ohne dich.</Muted>
        </Card>
      )}

      {error && <ErrorText>{error}</ErrorText>}

      {confirming ? (
        <Card style={{ gap: 10 }}>
          <Text style={styles.heading}>Wirklich löschen?</Text>
          <Muted>Das lässt sich nicht rückgängig machen.</Muted>
          <Button title="Endgültig löschen" variant="danger" loading={deleting} onPress={deleteAccount} />
          <Button
            title="Abbrechen"
            variant="secondary"
            disabled={deleting}
            onPress={() => setConfirming(false)}
          />
        </Card>
      ) : (
        <Button title="Konto löschen" variant="danger" onPress={() => setConfirming(true)} />
      )}
    </ScrollView>
  );
}

function Bullet({ icon, children }: { icon: keyof typeof Ionicons.glyphMap; children: ReactNode }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.bullet}>
      <Ionicons name={icon} size={18} color={colors.subtext} style={{ marginTop: 1 }} />
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  heading: { fontSize: 16, fontWeight: "700", color: colors.text },
  bullet: { flexDirection: "row", gap: 10 },
  bulletText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.text },
  warningCard: { borderColor: colors.danger, gap: 6 },
  balanceRow: { fontSize: 14, color: colors.text },
}));
