import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import type { WasteBin, WasteBinChange } from "../types/database";

/** Tonnen und ihre Verschiebungen einer WG, live aktualisiert. */
export function useWaste(householdId: string | undefined) {
  const [bins, setBins] = useState<WasteBin[]>([]);
  const [changes, setChanges] = useState<WasteBinChange[]>([]);
  const [loading, setLoading] = useState(true);
  // Mehrere Bildschirme nutzen den Hook gleichzeitig — jeder braucht seinen eigenen Kanal
  const channelSuffix = useRef(Math.random().toString(36).slice(2)).current;

  const reload = useCallback(async () => {
    if (!householdId) {
      setBins([]);
      setChanges([]);
      setLoading(false);
      return;
    }

    const { data: binRows, error } = await supabase
      .from("waste_bins")
      .select("*")
      .eq("household_id", householdId)
      .order("created_at");
    if (error) console.error(error);

    const loadedBins = (binRows as WasteBin[]) ?? [];
    setBins(loadedBins);

    if (loadedBins.length > 0) {
      const { data: changeRows } = await supabase
        .from("waste_bin_changes")
        .select("*")
        .in(
          "bin_id",
          loadedBins.map((bin) => bin.id)
        );
      setChanges((changeRows as WasteBinChange[]) ?? []);
    } else {
      setChanges([]);
    }
    setLoading(false);
  }, [householdId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!householdId) return;
    const channel = supabase
      .channel(`waste:${householdId}:${channelSuffix}`)
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "waste_bins", filter: `household_id=eq.${householdId}` },
        () => reload()
      )
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "waste_bin_changes" }, () =>
        reload()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [householdId, reload, channelSuffix]);

  return { bins, changes, loading, reload };
}
