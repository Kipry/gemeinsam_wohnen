import { Share, StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { colors } from "../src/lib/theme";
import { Button, Card, Loading, Muted, Screen } from "../src/components/ui";

/** Tiefer Link in die App; das Schema steht in app.json */
export function inviteLink(code: string): string {
  return `gemeinsamwohnen://join?code=${code}`;
}

export default function InviteScreen() {
  const { activeHousehold } = useHousehold();

  if (!activeHousehold) return <Loading />;

  const link = inviteLink(activeHousehold.invite_code);

  const share = async () => {
    await Share.share({
      message:
        `Komm in unsere WG „${activeHousehold.name}" bei Gemeinsam Wohnen!\n\n` +
        `${link}\n\n` +
        `Falls der Link nicht geht: Code ${activeHousehold.invite_code} in der App eingeben.`,
    });
  };

  return (
    <Screen>
      <View style={styles.content}>
        <Card style={styles.qrCard}>
          <QRCode value={link} size={200} backgroundColor={colors.card} color={colors.text} />
          <Text style={styles.code}>{activeHousehold.invite_code}</Text>
          <Muted>Abfotografieren oder Code eintippen</Muted>
        </Card>

        <Button title="Einladung teilen" onPress={share} />
        <Muted>
          Der Link öffnet die App direkt mit ausgefülltem Code. Wer die App noch nicht hat, kann
          den Code von Hand eingeben.
        </Muted>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 },
  qrCard: { alignItems: "center", gap: 12, paddingVertical: 24 },
  code: { fontSize: 30, fontWeight: "700", color: colors.primary, letterSpacing: 4 },
});
