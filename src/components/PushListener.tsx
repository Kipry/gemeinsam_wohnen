import { useCallback, useEffect, useRef } from "react";
import { router, usePathname, useRootNavigationState } from "expo-router";
import * as Notifications from "expo-notifications";
import { useAuth } from "../lib/AuthProvider";
import { useHousehold } from "../lib/HouseholdProvider";
import { pushSupported, registerPush, setCurrentPath } from "../lib/push";

/**
 * Hält den Push-Token aktuell und öffnet beim Antippen einer Mitteilung den
 * passenden Bildschirm — in der richtigen WG.
 */
export function PushListener() {
  const { session } = useAuth();
  const { households, activeHousehold, setActiveHousehold, loading } = useHousehold();
  const pathname = usePathname();
  const navigationReady = Boolean(useRootNavigationState()?.key);
  const handled = useRef<string | null>(null);
  const userId = session?.user.id;

  useEffect(() => {
    setCurrentPath(pathname);
  }, [pathname]);

  // Token kann sich ändern (Neuinstallation, Gerätewechsel) — bei jedem Start abgleichen
  useEffect(() => {
    if (userId) registerPush({ ask: false });
  }, [userId]);

  const open = useCallback(
    (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (handled.current === id) return;
      handled.current = id;

      const data = response.notification.request.content.data ?? {};
      const target = households.find((household) => household.id === data.householdId);
      if (target && target.id !== activeHousehold?.id) setActiveHousehold(target);
      if (typeof data.url === "string") router.push(data.url as never);
    },
    [households, activeHousehold, setActiveHousehold]
  );

  const ready = pushSupported && Boolean(userId) && !loading && navigationReady;

  // Antippen, während die App läuft
  useEffect(() => {
    if (!ready) return;
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [ready, open]);

  // Antippen hat die App erst gestartet
  useEffect(() => {
    if (!ready) return;
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      open(response);
      Notifications.clearLastNotificationResponseAsync();
    });
  }, [ready, open]);

  return null;
}
