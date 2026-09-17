import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import {
  Alert,
  AppState,
  Modal,
  Platform,
  SectionList,
  StyleSheet,
  Switch,
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
import { onReconnect, useOnline } from "../../src/lib/connectivity";
import { useOfflineSnapshot } from "../../src/lib/offlineCache";
import {
  applyPendingOps,
  newId,
  queueShoppingOp,
  usePendingShoppingOps,
  type ShoppingChange,
} from "../../src/lib/shoppingOutbox";
import type { ShoppingItem, ShoppingTrip } from "../../src/types/database";

type Undo = { message: string; items: ShoppingItem[]; action: "restore" | "remove" };

type ShoppingSnapshot = { items: ShoppingItem[]; history: string[]; trip: ShoppingTrip | null };

const NEEDS_NETWORK = "Dafür braucht es eine Verbindung. Abhaken und Eintragen klappt aber auch offline.";

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
  // Schloss neben dem Feld: Was jetzt eingetragen wird, sieht nur man selbst
  const [privateMode, setPrivateMode] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const online = useOnline();
  const userId = session?.user.id;
  const householdId = activeHousehold?.id;
  // Noch nicht gesendete Änderungen (offline) — auch beim Neuladen obendrauf rechnen
  const pending = usePendingShoppingOps(householdId);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  // Zu welcher WG die angezeigte Liste gehört — beim WG-Wechsel nicht die alte Liste unter der neuen speichern
  const [listFor, setListFor] = useState<string | null>(null);

  // Letzter Stand vom Gerät, bis das Netz antwortet
  const saveSnapshot = useOfflineSnapshot<ShoppingSnapshot>(
    householdId ? `shopping:${householdId}` : null,
    (snapshot) => {
      setItems(applyPendingOps(snapshot.items, pendingRef.current));
      setHistory(snapshot.history);
      setTrip(snapshot.trip);
      setListFor(householdId ?? null);
      setLoading(false);
    }
  );

  const queue = (change: ShoppingChange) => {
    if (!userId || !householdId) return;
    queueShoppingOp({ ...change, userId, householdId });
  };

  const loadTrip = useCallback(async () => {
    if (!activeHousehold || !session) return;
    const { data, error } = await supabase
      .from("shopping_trips")
      .select("*")
      .eq("household_id", activeHousehold.id)
      .eq("shopper", session.user.id)
      .is("finished_at", null)
      .maybeSingle();

    // Ohne Netz den laufenden Einkauf nicht aus Versehen beenden
    if (error) return;
    setTrip((data as ShoppingTrip) ?? null);
  }, [activeHousehold, session]);

  const startTrip = async () => {
    if (!activeHousehold) return;
    const { data, error, status } = await supabase.rpc("start_shopping_trip", {
      p_household_id: activeHousehold.id,
    });
    if (error) {
      Alert.alert(status === 0 ? "Keine Verbindung" : "Fehler", status === 0 ? NEEDS_NETWORK : error.message);
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
          const { error, status } = await supabase.rpc("cancel_shopping_trip", { p_trip_id: trip.id });
          if (error) {
            Alert.alert(status === 0 ? "Keine Verbindung" : "Fehler", status === 0 ? NEEDS_NETWORK : error.message);
            return;
          }
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

    if (error) {
      // Ohne Netz: beim angezeigten Stand bleiben statt die Liste zu leeren
      console.error(error);
      setLoading(false);
      return;
    }
    setItems(applyPendingOps((data as ShoppingItem[]) ?? [], pendingRef.current));
    setListFor(activeHousehold.id);
    setLoading(false);
  }, [activeHousehold]);
  const { refreshing, onRefresh } = useRefresh(load);

  // Häufig gekaufte Artikel als Vorschläge über der Tastatur
  const loadHistory = useCallback(async () => {
    if (!activeHousehold) return;
    const { data, error } = await supabase
      .from("shopping_items")
      .select("name")
      .eq("household_id", activeHousehold.id)
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) return;

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
          // Bei DELETE ist `new` ein leeres Objekt, die id steht in `old`
          const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as ShoppingItem;
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

  // Nach dem Abrechnen (Rückkehr von /finish-trip) ist die Sitzung vorbei.
  // Das Schloss geht beim Verlassen wieder aus — sonst landet morgen etwas aus Versehen privat.
  useFocusEffect(
    useCallback(() => {
      loadTrip();
      return () => setPrivateMode(false);
    }, [loadTrip])
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") setPrivateMode(false);
    });
    return () => subscription.remove();
  }, []);

  // Während der Funkstille hat die Echtzeit nichts geliefert — einmal alles holen
  useEffect(
    () =>
      onReconnect(() => {
        load();
        loadHistory();
        loadTrip();
      }),
    [load, loadHistory, loadTrip]
  );

  // Sind die offline gemachten Änderungen raus, mit dem Server abgleichen
  const pendingCount = pending.length;
  const previousPendingCount = useRef(pendingCount);
  useEffect(() => {
    if (previousPendingCount.current > 0 && pendingCount === 0) load();
    previousPendingCount.current = pendingCount;
  }, [pendingCount, load]);

  useEffect(() => {
    if (!loading && listFor === householdId) saveSnapshot({ items, history, trip });
  }, [items, history, trip, loading, listFor, householdId, saveSnapshot]);

  const newRow = (fields: Pick<ShoppingItem, "name" | "quantity">): ShoppingItem | null => {
    if (!userId || !householdId) return null;
    return {
      id: newId(),
      household_id: householdId,
      name: fields.name,
      quantity: fields.quantity,
      category: guessCategory(fields.name),
      status: "open",
      added_by: userId,
      bought_by: null,
      bought_at: null,
      trip_id: null,
      private: privateMode,
      created_at: new Date().toISOString(),
      deleted_at: null,
    };
  };

  const changeItems = (ids: string[], changes: Partial<ShoppingItem>) => {
    setItems((prev) => prev.map((entry) => (ids.includes(entry.id) ? { ...entry, ...changes } : entry)));
  };

  const addItem = async (rawName?: string) => {
    const value = (rawName ?? name).trim();
    if (!session || !activeHousehold || !value) return;
    // „2 Zwiebeln" soll als Zwiebeln mit 2× auf die Liste, nicht als Name mit 1×
    const { name: itemName, quantity } = splitAmount(value);

    // Deine private Milch hält niemanden davon ab, Milch für alle einzutragen
    const duplicate = items.find(
      (item) =>
        item.status === "open" &&
        item.private === privateMode &&
        normalizeName(item.name) === normalizeName(itemName)
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

    // Sofort auf der Liste — gesendet wird, sobald Netz da ist
    const row = newRow({ name: itemName, quantity });
    if (!row) return;
    setItems((prev) => [...prev, row]);
    queue({ kind: "insert", rows: [row] });
    hapticTap();
  };

  const togglePrivateMode = () => {
    hapticTap();
    setPrivateMode((prev) => !prev);
    setHint(null);
    inputRef.current?.focus();
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

  const addPasted = (entries: PastedItem[]) => {
    setPasted(null);
    const rows = entries.map((entry) => newRow(entry)).filter((row): row is ShoppingItem => row !== null);
    if (rows.length === 0) return;

    setItems((prev) => [...prev, ...rows]);
    queue({ kind: "insert", rows });
    hapticSuccess();
    setUndo({
      message: rows.length === 1 ? `„${rows[0].name}" hinzugefügt` : `${rows.length} Artikel hinzugefügt`,
      items: rows,
      action: "remove",
    });
  };

  // Alle Änderungen setzen feste Werte — doppelt gesendet schadet nichts
  const toggleBought = (item: ShoppingItem) => {
    if (!userId) return;
    const bought = item.status === "open";
    if (bought) hapticTap();

    const changes = {
      status: bought ? ("bought" as const) : ("open" as const),
      bought_by: bought ? userId : null,
      bought_at: bought ? new Date().toISOString() : null,
      // Während einer laufenden Sitzung gehört alles Abgehakte zu diesem Einkauf
      trip_id: bought ? trip?.id ?? null : null,
    };
    changeItems([item.id], changes);
    queue({ kind: "update", itemIds: [item.id], changes });
  };

  const setQuantity = (item: ShoppingItem, delta: number) => {
    const current = Number(item.quantity ?? "1") || 1;
    const quantity = String(Math.max(1, Math.min(99, current + delta)));
    changeItems([item.id], { quantity });
    queue({ kind: "update", itemIds: [item.id], changes: { quantity } });
  };

  const removeItem = (item: ShoppingItem) => {
    setItems((prev) => prev.filter((entry) => entry.id !== item.id));
    setUndo({ message: `„${item.name}" gelöscht`, items: [item], action: "restore" });
    queue({ kind: "update", itemIds: [item.id], changes: { deleted_at: new Date().toISOString() } });
  };

  const undoLast = () => {
    if (!undo) return;
    setUndo(null);
    const ids = undo.items.map((item) => item.id);
    if (undo.action === "remove") {
      setItems((prev) => prev.filter((entry) => !ids.includes(entry.id)));
      queue({ kind: "update", itemIds: ids, changes: { deleted_at: new Date().toISOString() } });
    } else {
      setItems((prev) =>
        [...prev.filter((entry) => !ids.includes(entry.id)), ...undo.items].sort((a, b) =>
          a.created_at.localeCompare(b.created_at)
        )
      );
      queue({ kind: "update", itemIds: ids, changes: { deleted_at: null } });
    }
  };

  const changeCategory = (item: ShoppingItem, category: string) => {
    setCategoryFor(null);
    changeItems([item.id], { category });
    queue({ kind: "update", itemIds: [item.id], changes: { category } });
  };

  const setItemPrivate = async (item: ShoppingItem, value: boolean) => {
    hapticTap();
    // Schalter sofort umlegen, sonst springt er bis zur Antwort zurück
    setCategoryFor({ ...item, private: value });
    const { data, error, status } = await supabase.rpc("set_shopping_item_private", {
      p_item_id: item.id,
      p_private: value,
    });
    if (error || !data) {
      setCategoryFor(item);
      Alert.alert(
        status === 0 ? "Keine Verbindung" : "Nicht geändert",
        status === 0 ? NEEDS_NETWORK : error?.message ?? "Bitte nochmal versuchen"
      );
      return;
    }
    // Privat machen legt den Artikel neu an (neue id), damit er bei den anderen verschwindet
    const updated = data as ShoppingItem;
    setItems((prev) =>
      [...prev.filter((entry) => entry.id !== item.id && entry.id !== updated.id), updated].sort((a, b) =>
        a.created_at.localeCompare(b.created_at)
      )
    );
    setCategoryFor(updated);
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

  // Was in der gerade gewählten Sichtbarkeit schon offen auf der Liste steht
  const openNames = useMemo(
    () =>
      new Set(
        items
          .filter((item) => item.status === "open" && item.private === privateMode)
          .map((item) => normalizeName(item.name))
      ),
    [items, privateMode]
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
            style={[styles.input, privateMode && styles.inputPrivate]}
            placeholder={privateMode ? "Nur für dich …" : "Was fehlt?"}
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
          <TouchableOpacity
            style={[styles.lockButton, privateMode && styles.lockButtonOn]}
            onPress={togglePrivateMode}
            accessibilityRole="switch"
            accessibilityState={{ checked: privateMode }}
            accessibilityLabel="Nur für mich eintragen"
          >
            <Ionicons
              name={privateMode ? "lock-closed" : "lock-open-outline"}
              size={18}
              color={privateMode ? colors.tint : colors.subtext}
            />
          </TouchableOpacity>
          <TouchableOpacity style={styles.addButton} onPress={() => addItem()} accessibilityLabel="Hinzufügen">
            <Ionicons name="add" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        {privateMode && <Text style={styles.privateHint}>Nur du siehst, was du jetzt einträgst</Text>}
        {hint && <Text style={styles.hint}>{hint}</Text>}
        {pendingCount > 0 && !online && (
          <View style={styles.pendingRow}>
            <Ionicons name="cloud-offline-outline" size={14} color={colors.warning} />
            <Text style={styles.pendingText}>
              {pendingCount === 1 ? "1 Änderung wartet" : `${pendingCount} Änderungen warten`} auf Netz – geht
              automatisch raus
            </Text>
          </View>
        )}

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
          <TouchableOpacity
            style={styles.tripDone}
            onPress={() =>
              online
                ? router.push("/finish-trip")
                : Alert.alert("Keine Verbindung", "Abrechnen geht, sobald du wieder Netz hast – zum Beispiel zu Hause.")
            }
          >
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

              <TouchableOpacity style={styles.nameButton} onPress={() => toggleBought(item)}>
                <Text style={[styles.itemName, bought && styles.itemDone]}>{item.name}</Text>
                {item.private && (
                  <Ionicons name="lock-closed" size={12} color={colors.subtext} accessibilityLabel="Nur für dich" />
                )}
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
        privateMode={privateMode}
        alreadyOnList={openNames}
        onCancel={() => setPasted(null)}
        onAdd={addPasted}
      />

      <Modal visible={categoryFor !== null} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setCategoryFor(null)}>
          {/* Tippen in die Karte schließt nicht — nur daneben */}
          <TouchableOpacity activeOpacity={1} style={styles.modalCard}>
            <Text style={styles.modalTitle}>„{categoryFor?.name}"</Text>
            <Text style={styles.modalLabel}>Regal</Text>
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
            {/* Privat machen darf nur, wer den Artikel eingetragen hat */}
            {categoryFor && categoryFor.added_by === session?.user.id && (
              <View style={styles.switchRow}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.subtext} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.switchLabel}>Nur für mich</Text>
                  <Text style={styles.switchHint}>Die anderen sehen diesen Artikel nicht.</Text>
                </View>
                <Switch
                  value={categoryFor.private}
                  onValueChange={(value) => setItemPrivate(categoryFor, value)}
                  accessibilityLabel="Nur für mich"
                />
              </View>
            )}
          </TouchableOpacity>
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
  inputPrivate: { borderColor: colors.tint },
  lockButton: {
    width: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
  lockButtonOn: { borderColor: colors.tint, backgroundColor: colors.eventTint },
  privateHint: { fontSize: 13, color: colors.tint },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  pendingText: { flex: 1, fontSize: 13, color: colors.warning },
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
  nameButton: { flex: 1, flexDirection: "row", alignItems: "center", gap: 5 },
  itemName: { flexShrink: 1, fontSize: 15, color: colors.text },
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
  modalLabel: { fontSize: 12, fontWeight: "700", color: colors.subtext, textTransform: "uppercase" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  switchLabel: { fontSize: 15, fontWeight: "600", color: colors.text },
  switchHint: { fontSize: 12, color: colors.subtext, marginTop: 1 },
}));
