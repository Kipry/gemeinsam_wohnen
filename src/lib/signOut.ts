import { router } from "expo-router";
import { supabase } from "./supabase";
import { unregisterPush } from "./push";
import { clearCache } from "./offlineCache";
import { clearShoppingOutbox } from "./shoppingOutbox";

/**
 * Abmelden und zurück zum Login. Die Weiterleitung in den Tabs greift nur,
 * wenn die Tabs sichtbar sind — von „Mehr" aus bliebe sonst ein Bildschirm
 * ohne Sitzung offen.
 */
export async function signOutToLogin(scope: "global" | "local" = "global") {
  await unregisterPush();
  await supabase.auth.signOut({ scope });
  // Gespeicherte Listen und Unversendetes gehören zum abgemeldeten Konto
  await Promise.all([clearCache(), clearShoppingOutbox()]);
  if (router.canDismiss()) router.dismissAll();
  router.replace("/(auth)/login");
}
