import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "../src/lib/AuthProvider";
import { HouseholdProvider } from "../src/lib/HouseholdProvider";
import { colors } from "../src/lib/theme";

export default function RootLayout() {
  return (
    <AuthProvider>
      <HouseholdProvider>
        <StatusBar style="auto" />
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
          <Stack.Screen name="absences" options={{ title: "Abwesenheiten" }} />
          <Stack.Screen name="teams" options={{ title: "Teams" }} />
          <Stack.Screen name="stats" options={{ title: "Statistik" }} />
        </Stack>
      </HouseholdProvider>
    </AuthProvider>
  );
}
