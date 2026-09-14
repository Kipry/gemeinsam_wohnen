import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { supabase } from "./supabase";

export type PushStatus = "granted" | "denied" | "undetermined" | "unsupported";

export const pushSupported = Platform.OS !== "web";

let registeredToken: string | null = null;
let currentPath = "";

/** Wird vom PushListener gepflegt, damit Mitteilungen zum offenen Bildschirm still bleiben */
export function setCurrentPath(path: string) {
  currentPath = path;
}

if (pushSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      // Wer gerade im Chat ist, braucht kein Banner für die Nachricht, die er eh sieht
      const url = notification.request.content.data?.url;
      const alreadyThere = typeof url === "string" && url === currentPath;
      return {
        shouldShowBanner: !alreadyThere,
        shouldShowList: true,
        shouldPlaySound: !alreadyThere,
        shouldSetBadge: false,
      };
    },
  });
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!pushSupported) return "unsupported";
  const { status } = await Notifications.getPermissionsAsync();
  return status as PushStatus;
}

/**
 * Hinterlegt den Push-Token dieses Geräts fürs angemeldete Konto.
 * Mit `ask` fragt iOS einmalig um Erlaubnis — sonst nur, wenn schon erlaubt.
 */
export async function registerPush({ ask }: { ask: boolean }): Promise<PushStatus> {
  if (!pushSupported) return "unsupported";

  let { status } = await Notifications.getPermissionsAsync();
  if (status === "undetermined" && ask) {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== "granted") return status as PushStatus;

  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Standard",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const { error } = await supabase.rpc("register_push_token", {
      p_token: token,
      p_platform: Platform.OS,
    });
    if (error) throw error;
    registeredToken = token;
  } catch (error) {
    // Z.B. in Expo Go oder ohne Netz — die App funktioniert trotzdem
    console.warn("Push-Token konnte nicht registriert werden", error);
  }
  return "granted";
}

/** Vor dem Abmelden: Mitteilungen fürs alte Konto sollen nicht mehr auf diesem Gerät landen */
export async function unregisterPush() {
  if (!registeredToken) return;
  try {
    await supabase.from("push_tokens").delete().eq("token", registeredToken);
  } catch (error) {
    console.warn("Push-Token konnte nicht entfernt werden", error);
  }
  registeredToken = null;
}
