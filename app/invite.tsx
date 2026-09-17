import { Share, StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { makeStyles, useColors } from "../src/lib/theme";
import { inviteUrl } from "../src/lib/links";
import { Button, Card, Loading, Muted, Screen } from "../src/components/ui";

export default function InviteScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { activeHousehold } = useHousehold();

  if (!activeHousehold) return <Loading />;

  const link = inviteUrl(activeHousehold.invite_code);

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

const useStyles = makeStyles((colors) => ({
  content: { padding: 16, gap: 14 },
  qrCard: { alignItems: "center", gap: 12, paddingVertical: 24 },
  code: { fontSize: 30, fontWeight: "700", color: colors.tint, letterSpacing: 4 },
}));
