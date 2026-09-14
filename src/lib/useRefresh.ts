import { useCallback, useState } from "react";

/**
 * Für „nach unten ziehen zum Aktualisieren". Der Kreisel bleibt kurz stehen,
 * auch wenn das Laden blitzschnell ist — sonst zuckt er nur einmal.
 */
export function useRefresh(reload: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([reload(), new Promise((resolve) => setTimeout(resolve, 400))]);
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  return { refreshing, onRefresh };
}
