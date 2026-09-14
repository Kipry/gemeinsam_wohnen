import { StyleSheet, useColorScheme } from "react-native";

// Alle Textfarben erreichen auf `background` und `card` mindestens WCAG AA (4,5:1),
// weiße Schrift auf `primary`, `danger` und `success` ebenso.
const light = {
  background: "#F7F7FB",
  card: "#FFFFFF",
  text: "#1C1C28",
  subtext: "#6B6B7B",
  border: "#E4E4EE",
  /** Flächen: Buttons, gewählte Chips, Balken — Schrift darauf ist weiß */
  primary: "#5B5FEF",
  primaryText: "#FFFFFF",
  /** Akzent für Schrift und Symbole direkt auf Hintergrund oder Karte */
  tint: "#5055E8",
  danger: "#D93A40",
  dangerText: "#C62F35",
  success: "#27823A",
  successText: "#23773A",
  warning: "#9E5300",
  /** Balken und Punkte im Kalender */
  eventTint: "#E4E5FD",
  absenceTint: "#FDEBD5",
  absenceAccent: "#F08C00",
  /** Hinweisleiste „Rückgängig" */
  toast: "#1C1C28",
  toastText: "#FFFFFF",
};

export type Colors = typeof light;

const dark: Colors = {
  background: "#0F0F14",
  card: "#1A1A22",
  text: "#EDEDF3",
  subtext: "#A3A3B5",
  border: "#2D2D39",
  primary: "#5B5FEF",
  primaryText: "#FFFFFF",
  tint: "#A3A6FF",
  danger: "#D93A40",
  dangerText: "#FF8A8D",
  success: "#27823A",
  successText: "#6BD686",
  warning: "#FFB547",
  eventTint: "#2C2D57",
  absenceTint: "#4A3418",
  absenceAccent: "#FFB547",
  toast: "#2D2D39",
  toastText: "#FFFFFF",
};

export const palettes = { light, dark };

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}

/**
 * Wie StyleSheet.create, nur mit den Farben des aktuellen Modus. Beide Varianten
 * entstehen einmal beim Laden — das Umschalten kostet zur Laufzeit nichts.
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(factory: (colors: Colors) => T) {
  const lightStyles = StyleSheet.create(factory(light));
  const darkStyles = StyleSheet.create(factory(dark));
  return function useStyles() {
    return useColorScheme() === "dark" ? darkStyles : lightStyles;
  };
}
