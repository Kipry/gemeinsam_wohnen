import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "../src/lib/AuthProvider";
import { HouseholdProvider } from "../src/lib/HouseholdProvider";

export default function RootLayout() {
  return (
    <AuthProvider>
      <HouseholdProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
        </Stack>
      </HouseholdProvider>
    </AuthProvider>
  );
}
