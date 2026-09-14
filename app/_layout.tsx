import { useEffect, useMemo } from "react";
import { useColorScheme } from "react-native";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { AuthProvider } from "../src/lib/AuthProvider";
import { HouseholdProvider } from "../src/lib/HouseholdProvider";
import { useColors } from "../src/lib/theme";
import { PushListener } from "../src/components/PushListener";

export default function RootLayout() {
  const colors = useColors();
  const scheme = useColorScheme();

  // Header, Tab-Leiste und Modals folgen derselben Palette wie die Bildschirme
  const navigationTheme = useMemo(() => {
    const base = scheme === "dark" ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.tint,
        background: colors.background,
        card: colors.card,
        text: colors.text,
        border: colors.border,
        notification: colors.danger,
      },
    };
  }, [scheme, colors]);

  // Sonst blitzt beim Öffnen von Modals kurz der weiße Fensterhintergrund durch
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.background).catch(() => {});
  }, [colors.background]);

  return (
    <ThemeProvider value={navigationTheme}>
      <AuthProvider>
        <HouseholdProvider>
          <StatusBar style="auto" />
          <PushListener />
          <Stack screenOptions={{ headerTintColor: colors.text }}>
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen
              name="new-task"
              options={{ title: "Neue Aufgabe", presentation: "modal" }}
            />
            <Stack.Screen
              name="new-expense"
              options={{ title: "Neue Ausgabe", presentation: "modal" }}
            />
            <Stack.Screen
              name="finish-trip"
              options={{ title: "Einkauf abrechnen", presentation: "modal" }}
            />
            <Stack.Screen name="expense/[id]" options={{ title: "Ausgabe" }} />
            <Stack.Screen name="task/[id]" options={{ title: "Aufgabe" }} />
            <Stack.Screen
              name="new-recurring"
              options={{ title: "Neue feste Kosten", presentation: "modal" }}
            />
            <Stack.Screen name="recurring" options={{ title: "Feste Kosten" }} />
            <Stack.Screen name="invite" options={{ title: "Einladen" }} />
            <Stack.Screen name="join" options={{ headerShown: false }} />
            <Stack.Screen name="more" options={{ title: "Mehr" }} />
            <Stack.Screen name="review" options={{ title: "Monatsrückblick" }} />
            <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="claim" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen
              name="new-event"
              options={{ title: "Neuer Termin", presentation: "modal" }}
            />
            <Stack.Screen name="event/[id]" options={{ title: "Termin" }} />
            <Stack.Screen
              name="new-absence"
              options={{ title: "Ich bin weg", presentation: "modal" }}
            />
            <Stack.Screen
              name="new-poll"
              options={{ title: "Neue Umfrage", presentation: "modal" }}
            />
            <Stack.Screen name="teams" options={{ title: "Teams" }} />
            <Stack.Screen name="stats" options={{ title: "Statistik" }} />
            <Stack.Screen name="delete-account" options={{ title: "Konto löschen" }} />
            <Stack.Screen name="notifications" options={{ title: "Mitteilungen" }} />
            <Stack.Screen name="chore/[taskId]" options={{ title: "Aufgabe" }} />
            <Stack.Screen name="waste" options={{ title: "Müllabfuhr" }} />
            <Stack.Screen name="waste-bin" options={{ title: "Tonne", presentation: "modal" }} />
            <Stack.Screen name="waste-change" options={{ title: "Abholung", presentation: "modal" }} />
          </Stack>
        </HouseholdProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
