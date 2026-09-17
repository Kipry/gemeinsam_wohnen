import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../src/lib/AuthProvider";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { useOnline } from "../src/lib/connectivity";
import { OfflineScreen } from "../src/components/Offline";

export default function Index() {
  const { session, loading: authLoading } = useAuth();
  const { activeHousehold, loading: householdLoading, refresh } = useHousehold();
  const online = useOnline();

  if (authLoading || (session && householdLoading)) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  if (!activeHousehold) {
    if (!online) return <OfflineScreen onRetry={refresh} />;
    return <Redirect href="/(auth)/household" />;
  }

  return <Redirect href="/(tabs)/tasks" />;
}
