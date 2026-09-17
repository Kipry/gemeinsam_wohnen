import { useAuth } from "../lib/AuthProvider";
import { useShoppingOutboxSync } from "../lib/shoppingOutbox";

/** Schickt offline gemachte Änderungen los, sobald wieder Netz da ist */
export function OfflineSync() {
  const { session } = useAuth();
  useShoppingOutboxSync(session?.user.id ?? null);
  return null;
}
