import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import {
  Alert,
  Modal,
  Platform,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../src/lib/supabase";
import { useRefresh } from "../../src/lib/useRefresh";
import { hapticSuccess, hapticTap } from "../../src/lib/haptics";
import { useAuth } from "../../src/lib/AuthProvider";
import { useHousehold } from "../../src/lib/HouseholdProvider";
import { makeStyles, useColors } from "../../src/lib/theme";
import { AISLE_ORDER, guessCategory, normalizeName } from "../../src/lib/shoppingCategories";
import { parseShoppingList, pastedLines, splitAmount, type PastedItem } from "../../src/lib/pastedList";
import { Chip, Empty, Loading, pullToRefresh, Screen, UndoToast } from "../../src/components/ui";
import { PastedListSheet } from "../../src/components/PastedListSheet";
import type { ShoppingItem, ShoppingTrip } from "../../src/types/database";

type Undo = { message: string; ids: string[]; action: "restore" | "remove" };

/** Zählbare Menge bekommt Plus/Minus, „500 g" oder „1 Dose" steht nur da */
const isCount = (quantity: string | null) => quantity === null || /^\d{1,2}$/.test(quantity);

export default function ShoppingScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [categoryFor, setCategoryFor] = useState<ShoppingItem | null>(null);
  const [trip, setTrip] = useState<ShoppingTrip | null>(null);
  const [pasted, setPasted] = useState<PastedItem[] | null>(null);
  const inputRef = useRef<TextInput>(null);

  const loadTrip = useCallback(async () => {
    if (!activeHousehold || !session) return;
    const { data } = await supabase
      .from("shopping_trips")
      .select("*")
      .eq("household_id", activeHousehold.id)
      .eq("shopper", session.user.id)
      .is("finished_at", null)
      .maybeSingle();

    setTrip((data as ShoppingTrip) ?? null);
  }, [activeHousehold, session]);

  const startTrip = async () => {
    if (!activeHousehold) return;
    const { data, error } = await supabase.rpc("start_shopping_trip", {
      p_household_id: activeHousehold.id,
    });
    if (error) {
      Alert.alert("Fehler", error.message);
      return;
    }
    setTrip(data as ShoppingTrip);
  };

  const cancelTrip = async () => {
    if (!trip) return;
    Alert.alert("Einkauf beenden", "Ohne Ausgabe abschließen?", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Beenden",
        onPress: async () => {
          await supabase.rpc("cancel_shopping_trip", { p_trip_id: trip.id });
          setTrip(null);
        },
      },
    ]);
  };

  const load = useCallback(async () => {
    if (!activeHousehold) return;
    const { data, error } = await supabase
      .from("shopping_items")
      .select("*")
      .eq("household_id", activeHousehold.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    if (error) console.error(error);
    setItems((data as ShoppingItem[]) ?? []);
    setLoading(false);
  }, [activeHousehold]);
  const { refreshing, onRefresh } = useRefresh(load);

  // Häufig gekaufte Artikel als Vorschläge über der Tastatur
  const loadHistory = useCallback(async () => {
    if (!activeHousehold) return;
    const { data } = await supabase
      .from("shopping_items")
      .select("name")
      .eq("household_id", activeHousehold.id)
      .order("created_at", { ascending: false })
      .limit(300);

    const counts = new Map<string, { name: string; count: number }>();
    for (const row of (data as { name: string }[]) ?? []) {
      const key = normalizeName(row.name);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { name: row.name, count: 1 });
    }

    setHistory(
      [...counts.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 12)
        .map((entry) => entry.name)
    );
  }, [activeHousehold]);

  useEffect(() => {
    load();
    loadHistory();
    loadTrip();
    if (!activeHousehold) return;

    // Einzelne Ereignisse einpflegen statt die ganze Liste neu zu laden —
    // sonst ruckelt es im Laden bei jedem Häkchen für alle Beteiligten.
    const channel = supabase
      .channel(`shopping_items:${activeHousehold.id}`)
      .on(
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "shopping_items",
          filter: `household_id=eq.${activeHousehold.id}`,
        },
        (payload: any) => {
          const row = (payload.new ?? payload.old) as ShoppingItem;
          setItems((prev) => {
            const without = prev.filter((item) => item.id !== row.id);
            const gone = payload.eventType === "DELETE" || row.deleted_at !== null;
            return gone ? without : [...without, row].sort((a, b) => a.created_at.localeCompare(b.created_at));
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeHousehold, load, loadHistory, loadTrip]);

  // Nach dem Abrechnen (Rückkehr von /finish-trip) ist die Sitzung vorbei
  useFocusEffect(
    useCallback(() => {
      loadTrip();
    }, [loadTrip])
  );

  const addItem = async (rawName?: string) => {
    const value = (rawName ?? name).trim();
    if (!session || !activeHousehold || !value) return;
    // „2 Zwiebeln" soll als Zwiebeln mit 2× auf die Liste, nicht als Name mit 1×
    const { name: itemName, quantity } = splitAmount(value);

    const duplicate = items.find(
      (item) => item.status === "open" && normalizeName(item.name) === normalizeName(itemName)
    );
    if (duplicate) {
      setHint(`„${duplicate.name}" steht schon auf der Liste`);
      setName("");
      inputRef.current?.focus();
      return;
    }

    setHint(null);
    setName("");
    inputRef.current?.focus();

    const { error } = await supabase.from("shopping_items").insert({
      household_id: activeHousehold.id,
      name: itemName,
      quantity,
      category: guessCategory(itemName),
      added_by: session.user.id,
    });

    if (error) {
      Alert.alert("Fehler", error.message);
      setName(value);
      return;
    }
    hapticTap();
    load();
  };

  const submitOnWebEnter = (event: any) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      addItem();
    }
  };

  // Mehrere Zeilen kommen nur durchs Einfügen ins Feld — die Eingabetaste schickt ab.
  // Bei manchen Android-Tastaturen landet sie aber als Zeilenumbruch hier.
  const changeName = (value: string) => {
    if (!/[\r\n]/.test(value)) {
      setName(value);
      return;
    }

    const lines = pastedLines(value);
    if (lines.length <= 1) {
      addItem(lines[0] ?? "");
      if (lines.length === 0) setName("");
      return;
    }

    setName("");
    const parsed = parseShoppingList(value);
    if (parsed.length === 0) {
      setHint("In der eingefügten Liste war nichts zum Einkaufen dabei");
    } else if (parsed.length === 1) {
      addPasted(parsed);
    } else {
      setHint(null);
      setPasted(parsed);
    }
  };

  const addPasted = async (entries: PastedItem[]) => {
    setPasted(null);
    if (!session || !activeHousehold || entries.length === 0) return;

    const { data, error } = await supabase
      .from("shopping_items")
      .insert(
        entries.map((entry) => ({
          household_id: activeHousehold.id,
          name: entry.name,
          quantity: entry.quantity,
          category: guessCategory(entry.name),
          added_by: session.user.id,
        }))
      )
      .select("id");

    if (error) {
      Alert.alert("Fehler", error.message);
      return;
    }
    hapticSuccess();
    setUndo({
      message: entries.length === 1 ? `„${entries[0].name}" hinzugefügt` : `${entries.length} Artikel hinzugefügt`,
      ids: (data ?? []).map((row) => row.id as string),
      action: "remove",
    });
    load();
  };

  const toggleBought = async (item: ShoppingItem) => {
    if (!session) return;
    const bought = item.status === "open";
    if (bought) hapticTap();

    // Optimistisch umschalten, damit das Häkchen sofort sitzt
    setItems((prev) =>
      prev.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              status: bought ? "bought" : "open",
              bought_by: bought ? session.user.id : null,
              bought_at: bought ? new Date().toISOString() : null,
            }
          : entry
      )
    );

    const { error } = await supabase
      .from("shopping_items")
      .update({
        status: bought ? "bought" : "open",
        bought_by: bought ? session.user.id : null,
        bought_at: bought ? new Date().toISOString() : null,
        // Während einer laufenden Sitzung gehört alles Abgehakte zu diesem Einkauf
        trip_id: bought ? trip?.id ?? null : null,
      })
      .eq("id", item.id);

    if (error) {
      Alert.alert("Fehler", error.message);
      load();
    }
  };

  const setQuantity = async (item: ShoppingItem, delta: number) => {
    const current = Number(item.quantity ?? "1") || 1;
    const next = Math.max(1, Math.min(99, current + delta));
    setItems((prev) =>
      prev.map((entry) => (entry.id === item.id ? { ...entry, quantity: String(next) } : entry))
    );
    await supabase.from("shopping_items").update({ quantity: String(next) }).eq("id", item.id);
  };

  const removeItem = async (item: ShoppingItem) => {
    setItems((prev) => prev.filter((entry) => entry.id !== item.id));
    setUndo({ message: `„${item.name}" gelöscht`, ids: [item.id], action: "restore" });
    await supabase
      .from("shopping_items")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", item.id);
  };

  const undoLast = async () => {
    if (!undo) return;
    setUndo(null);
    if (undo.action === "remove") {
      setItems((prev) => prev.filter((entry) => !undo.ids.includes(entry.id)));
    }
    await supabase
      .from("shopping_items")
      .update({ deleted_at: undo.action === "remove" ? new Date().toISOString() : null })
      .in("id", undo.ids);
    load();
  };

  const changeCategory = async (item: ShoppingItem, category: string) => {
    setCategoryFor(null);
    setItems((prev) => prev.map((entry) => (entry.id === item.id ? { ...entry, category } : entry)));
    await supabase.from("shopping_items").update({ category }).eq("id", item.id);
  };

  const sections = useMemo(() => {
    const open = items.filter((item) => item.status === "open");
    const done = items.filter((item) => item.status === "bought");

    const grouped: { title: string; data: ShoppingItem[] }[] = AISLE_ORDER.map((aisle) => ({
      title: aisle as string,
      data: open.filter((item) => (item.category ?? guessCategory(item.name)) === aisle),
    })).filter((section) => section.data.length > 0);

    if (done.length > 0) {
      grouped.push({ title: `Erledigt (${done.length})`, data: showDone ? done : [] });
    }
    return grouped;
  }, [items, showDone]);

  const tripItemCount = useMemo(
    () => (trip ? items.filter((item) => item.trip_id === trip.id).length : 0),
    [items, trip]
  );

  const openNames = useMemo(
    () => new Set(items.filter((item) => item.status === "open").map((item) => normalizeName(item.name))),
    [items]
  );

  const suggestions = useMemo(
    () => history.filter((entry) => !openNames.has(normalizeName(entry))).slice(0, 6),
    [history, openNames]
  );

  if (loading) return <Loading />;

  return (
    <Screen>
      <View style={styles.addBox}>
        <View style={styles.addRow}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Was fehlt?"
            placeholderTextColor={colors.subtext}
            value={name}
            onChangeText={changeName}
            onSubmitEditing={() => addItem()}
            returnKeyType="next"
            // Mehrzeilig nur, damit eingefügte Listen ihre Zeilen behalten
            multiline
            submitBehavior="submit"
            // Im Browser kennt das Textfeld submitBehavior nicht und wäre zwei Zeilen hoch
            {...(Platform.OS === "web" ? { rows: 1, onKeyPress: submitOnWebEnter } : null)}
            autoCorrect={false}
          />
          <TouchableOpacity style={styles.addButton} onPress={() => addItem()}>
            <Ionicons name="add" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        {hint && <Text style={styles.hint}>{hint}</Text>}

        {suggestions.length > 0 && (
          <View style={styles.suggestions}>
            {suggestions.map((entry) => (
              <Chip key={entry} label={entry} selected={false} onPress={() => addItem(entry)} />
            ))}
          </View>
        )}
      </View>

      {trip ? (
        <View style={styles.tripBar}>
          <Ionicons name="basket" size={18} color="#fff" />
          <Text style={styles.tripText}>
            Einkauf läuft · {tripItemCount} {tripItemCount === 1 ? "Artikel" : "Artikel"}
          </Text>
          <TouchableOpacity onPress={cancelTrip}>
            <Text style={styles.tripCancel}>Verwerfen</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tripDone} onPress={() => router.push("/finish-trip")}>
            <Text style={styles.tripDoneText}>Abrechnen</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.startTrip} onPress={startTrip}>
          <Ionicons name="basket-outline" size={18} color={colors.tint} />
          <Text style={styles.startTripText}>Ich kauf ein</Text>
        </TouchableOpacity>
      )}

      <SectionList

        refreshControl={pullToRefresh(refreshing, onRefresh)}
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 90 }}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Empty>Einkaufsliste ist leer.</Empty>
            <Text style={styles.emptyTip}>
              Tipp: Eine kopierte Liste, z.B. die Zutaten aus einem Rezept, einfach ins Feld oben
              einfügen – jede Zeile wird ein Artikel.
            </Text>
          </View>
        }
        renderSectionHeader={({ section }) => {
          const isDone = section.title.startsWith("Erledigt");
          return (
            <TouchableOpacity
              disabled={!isDone}
              onPress={() => setShowDone((prev) => !prev)}
              style={styles.sectionHeader}
            >
              <Text style={styles.sectionTitle}>{section.title}</Text>
              {isDone && (
                <Ionicons
                  name={showDone ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={colors.subtext}
                />
              )}
            </TouchableOpacity>
          );
        }}
        renderItem={({ item }) => {
          const bought = item.status === "bought";
          const quantity = Number(item.quantity ?? "1") || 1;
          return (
            <View style={styles.row}>
              <TouchableOpacity style={styles.check} onPress={() => toggleBought(item)}>
                <Ionicons
                  name={bought ? "checkmark-circle" : "ellipse-outline"}
                  size={24}
                  color={bought ? colors.successText : colors.subtext}
                />
              </TouchableOpacity>

              <TouchableOpacity style={{ flex: 1 }} onPress={() => toggleBought(item)}>
                <Text style={[styles.itemName, bought && styles.itemDone]}>{item.name}</Text>
              </TouchableOpacity>

              {!bought && isCount(item.quantity) && (
                <View style={styles.stepper}>
                  <TouchableOpacity onPress={() => setQuantity(item, -1)} style={styles.stepperButton}>
                    <Ionicons name="remove" size={14} color={colors.text} />
                  </TouchableOpacity>
                  <Text style={styles.quantity}>{quantity}×</Text>
                  <TouchableOpacity onPress={() => setQuantity(item, 1)} style={styles.stepperButton}>
                    <Ionicons name="add" size={14} color={colors.text} />
                  </TouchableOpacity>
                </View>
              )}
              {!bought && !isCount(item.quantity) && (
                <Text style={styles.amount} numberOfLines={1}>
                  {item.quantity}
                </Text>
              )}

              <TouchableOpacity onPress={() => setCategoryFor(item)} style={styles.iconButton}>
                <Ionicons name="pricetag-outline" size={16} color={colors.subtext} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => removeItem(item)} style={styles.iconButton}>
                <Ionicons name="trash-outline" size={16} color={colors.subtext} />
              </TouchableOpacity>
            </View>
          );
        }}
      />

      <UndoToast message={undo?.message ?? null} onUndo={undoLast} onHide={() => setUndo(null)} />

      <PastedListSheet
        items={pasted}
        alreadyOnList={openNames}
        onCancel={() => setPasted(null)}
        onAdd={addPasted}
      />

      <Modal visible={categoryFor !== null} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setCategoryFor(null)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Regal für „{categoryFor?.name}"</Text>
            <View style={styles.suggestions}>
              {AISLE_ORDER.map((aisle) => (
                <Chip
                  key={aisle}
                  label={aisle}
                  selected={(categoryFor?.category ?? "") === aisle}
                  onPress={() => categoryFor && changeCategory(categoryFor, aisle)}
                />
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  addBox: {
    padding: 16,
    paddingBottom: 10,
    gap: 8,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  addRow: { flexDirection: "row", gap: 8 },
  input: {
    flex: 1,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    maxHeight: 120,
  },
  addButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    width: 46,
    justifyContent: "center",
    alignItems: "center",
  },
  hint: { fontSize: 13, color: colors.dangerText },
  suggestions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  startTrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  startTripText: { fontSize: 15, fontWeight: "600", color: colors.tint },
  tripBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.primary,
  },
  tripText: { flex: 1, color: "#fff", fontSize: 14, fontWeight: "600" },
  tripCancel: { color: "#fff", fontSize: 13, textDecorationLine: "underline" },
  tripDone: {
    backgroundColor: "#fff",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  tripDoneText: { color: colors.primary, fontWeight: "700", fontSize: 13 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 14,
    paddingBottom: 6,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.subtext,
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 6,
  },
  check: { padding: 2 },
  itemName: { fontSize: 15, color: colors.text },
  itemDone: { textDecorationLine: "line-through", color: colors.subtext },
  stepper: { flexDirection: "row", alignItems: "center", gap: 4 },
  stepperButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  quantity: { fontSize: 13, color: colors.subtext, minWidth: 22, textAlign: "center" },
  amount: { fontSize: 13, color: colors.subtext, maxWidth: 110 },
  empty: { alignItems: "center", gap: 8, paddingHorizontal: 24 },
  emptyTip: { fontSize: 13, color: colors.subtext, textAlign: "center", lineHeight: 19 },
  iconButton: { padding: 6 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: { backgroundColor: colors.card, borderRadius: 14, padding: 20, gap: 12 },
  modalTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
}));
