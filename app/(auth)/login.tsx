import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import { Redirect } from "expo-router";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/lib/AuthProvider";
import { makeStyles, useColors } from "../../src/lib/theme";

/**
 * Anmeldung nur über Apple (Google folgt). E-Mail und Passwort gibt es nicht mehr:
 * Supabase verschickt ohne eigenen Mailserver keine Bestätigungs- und Reset-Mails an
 * fremde Adressen. Nur in der Entwicklung bleibt die Passwort-Anmeldung für Testkonten.
 */
const TEST_LOGIN = __DEV__;

export default function Login() {
  const styles = useStyles();
  const colors = useColors();
  const { session } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);

  if (session) {
    return <Redirect href="/" />;
  }

  const signInWithTestAccount = async () => {
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  };

  const signInWithApple = async () => {
    setError(null);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        setError("Apple hat kein Identity-Token geliefert.");
        return;
      }

      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: "apple",
        token: credential.identityToken,
      });
      if (error) {
        setError(error.message);
        return;
      }

      // Apple liefert den Namen nur bei der allerersten Anmeldung. In der WG reicht der
      // Vorname — der volle Name wirkte fremd; ändern lässt er sich unter „Mehr".
      const appleName =
        credential.fullName?.givenName?.trim() ||
        credential.fullName?.nickname?.trim() ||
        credential.fullName?.familyName?.trim() ||
        "";
      if (appleName && data.user) {
        await supabase.from("profiles").update({ full_name: appleName }).eq("id", data.user.id);
      }
    } catch (e: any) {
      if (e?.code === "ERR_REQUEST_CANCELED") return;
      setError(e?.message ?? "Apple-Anmeldung fehlgeschlagen");
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Text style={styles.title}>Gemeinsam Wohnen</Text>
      <Text style={styles.subtitle}>Der WG-Alltag an einem Ort</Text>

      {appleAvailable ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={10}
          style={styles.appleButton}
          onPress={signInWithApple}
        />
      ) : (
        !TEST_LOGIN && (
          <Text style={styles.hint}>Die Anmeldung ist bisher nur auf dem iPhone möglich.</Text>
        )
      )}

      {TEST_LOGIN && (
        <View style={styles.testBox}>
          <Text style={styles.testLabel}>Nur in der Entwicklung: Testkonto</Text>
          <TextInput
            style={styles.input}
            placeholder="E-Mail"
            placeholderTextColor={colors.subtext}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput
            style={styles.input}
            placeholder="Passwort"
            placeholderTextColor={colors.subtext}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <TouchableOpacity style={styles.button} onPress={signInWithTestAccount} disabled={loading}>
            {loading ? (
              <ActivityIndicator color={colors.primaryText} />
            ) : (
              <Text style={styles.buttonText}>Anmelden</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: colors.background,
    gap: 12,
  },
  title: { fontSize: 28, fontWeight: "700", color: colors.text, textAlign: "center" },
  subtitle: { fontSize: 15, color: colors.subtext, textAlign: "center", marginBottom: 12 },
  appleButton: { height: 48 },
  hint: { textAlign: "center", color: colors.subtext, fontSize: 14 },
  testBox: {
    gap: 10,
    marginTop: 12,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  testLabel: { textAlign: "center", color: colors.subtext, fontSize: 12 },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: "600" },
  error: { color: colors.dangerText, textAlign: "center" },
}));
