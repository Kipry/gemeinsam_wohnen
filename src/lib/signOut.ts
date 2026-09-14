import { router } from "expo-router";
import { supabase } from "./supabase";

/**
 * Abmelden und zurück zum Login. Die Weiterleitung in den Tabs greift nur,
 * wenn die Tabs sichtbar sind — von „Mehr" aus bliebe sonst ein Bildschirm
 * ohne Sitzung offen.
 */
export async function signOutToLogin(scope: "global" | "local" = "global") {
  await supabase.auth.signOut({ scope });
  if (router.canDismiss()) router.dismissAll();
  router.replace("/(auth)/login");
}
