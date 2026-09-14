import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

const supported = Platform.OS === "ios" || Platform.OS === "android";

/** Etwas ist geschafft: Aufgabe erledigt, Ausgabe gespeichert, Schulden beglichen */
export function hapticSuccess() {
  if (!supported) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** Kleiner Tick für schnelle Handgriffe: abhaken, zusagen, absenden */
export function hapticTap() {
  if (!supported) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
