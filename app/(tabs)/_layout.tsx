import { Redirect, Tabs, router } from "expo-router";
import { TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "../../src/lib/theme";
import { useAuth } from "../../src/lib/AuthProvider";
import { useHousehold } from "../../src/lib/HouseholdProvider";
import { Loading } from "../../src/components/ui";

// "Mehr" liegt als Symbol in der Kopfzeile statt als sechster Tab —
// mehr als fünf Tabs werden auf dem iPhone zu eng.
function MoreButton() {
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={() => router.push("/more")}
      style={{ paddingHorizontal: 16 }}
      accessibilityLabel="Mehr"
    >
      <Ionicons name="person-circle-outline" size={26} color={colors.text} />
    </TouchableOpacity>
  );
}

export default function TabsLayout() {
  const colors = useColors();
  const { session, loading: authLoading } = useAuth();
  const { activeHousehold, loading: householdLoading } = useHousehold();

  // Erst entscheiden, wenn Sitzung und WGs geladen sind — sonst landet ein
  // direkt geöffneter Tab (Link, Push-Benachrichtigung) bei "WG einrichten".
  if (authLoading || (session && householdLoading)) {
    return <Loading />;
  }

  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }
  if (!activeHousehold) {
    return <Redirect href="/(auth)/household" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerTintColor: colors.text,
        headerRight: () => <MoreButton />,
        tabBarActiveTintColor: colors.tint,
        tabBarInactiveTintColor: colors.subtext,
      }}
    >
      <Tabs.Screen
        name="tasks"
        options={{
          title: "Putzplan",
          tabBarIcon: ({ color, size }) => <Ionicons name="sparkles" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="shopping"
        options={{
          title: "Einkauf",
          tabBarIcon: ({ color, size }) => <Ionicons name="cart" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="expenses"
        options={{
          title: "Kosten",
          tabBarIcon: ({ color, size }) => <Ionicons name="cash" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: "Kalender",
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
