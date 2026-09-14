import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "./supabase";

export type PickedReceipt = {
  uri: string;
  mimeType: string;
};

const BUCKET = "receipts";

/** Kamera gibt es im Web nicht — dort nur die Dateiauswahl anbieten. */
export const cameraAvailable = Platform.OS !== "web";

/**
 * Foto aufnehmen oder aus der Galerie wählen.
 * Gibt null zurück, wenn abgebrochen oder die Berechtigung verweigert wurde.
 */
export async function pickReceipt(source: "camera" | "library"): Promise<PickedReceipt | null> {
  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return null;
  }

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    // Kassenbons brauchen keine volle Auflösung — spart Upload und Speicher
    quality: 0.6,
  };

  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];
  return { uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg" };
}

/** Lädt den Beleg hoch und hängt ihn an die Ausgabe. Gibt den Speicherpfad zurück. */
export async function attachReceipt(
  householdId: string,
  expenseId: string,
  receipt: PickedReceipt,
  previousPath?: string | null
): Promise<string> {
  const extension = receipt.mimeType === "image/png" ? "png" : "jpg";
  // Erstes Segment ist die WG — darauf prüfen die Storage-Rechte
  const path = `${householdId}/${expenseId}-${Date.now()}.${extension}`;

  const body = await (await fetch(receipt.uri)).arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, body, { contentType: receipt.mimeType, upsert: false });
  if (uploadError) throw uploadError;

  const { error: updateError } = await supabase
    .from("expenses")
    .update({ receipt_path: path })
    .eq("id", expenseId);
  if (updateError) throw updateError;

  if (previousPath) {
    await supabase.storage.from(BUCKET).remove([previousPath]);
  }

  return path;
}

export async function detachReceipt(expenseId: string, path: string): Promise<void> {
  const { error } = await supabase.from("expenses").update({ receipt_path: null }).eq("id", expenseId);
  if (error) throw error;
  await supabase.storage.from(BUCKET).remove([path]);
}

/** Zeitlich begrenzter Link zum Anzeigen — der Bucket selbst ist privat. */
export async function receiptUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  if (error) return null;
  return data.signedUrl;
}
