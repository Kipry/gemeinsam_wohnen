import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Modal,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/lib/AuthProvider";
import { useHousehold } from "../../src/lib/HouseholdProvider";
import { colors } from "../../src/lib/theme";
import { AISLE_ORDER, guessCategory, normalizeName } from "../../src/lib/shoppingCategories";
import { Chip, Empty, Loading, Screen, UndoToast } from "../../src/components/ui";
import type { ShoppingItem } from "../../src/types/database";

export default function ShoppingScreen() {
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [undo, setUndo] = useState<ShoppingItem | null>(null);
  const [categoryFor, setCategoryFor] = useState<ShoppingItem | null>(null);
  const inputRef = useRef<TextInput>(null);

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
  }, [activeHousehold, load, loadHistory]);

  const addItem = async (rawName?: string) => {
    const value = (rawName ?? name).trim();
    if (!session || !activeHousehold || !value) return;

    const duplicate = items.find(
      (item) => item.status === "open" && normalizeName(item.name) === normalizeName(value)
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
      name: value,
      category: guessCategory(value),
      added_by: session.user.id,
    });

    if (error) {
      Alert.alert("Fehler", error.message);
      setName(value);
      return;
    }
    load();
  };

  const toggleBought = async (item: ShoppingItem) => {
    if (!session) return;
    const bought = item.status === "open";

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
    setUndo(item);
    await supabase
      .from("shopping_items")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", item.id);
  };

  const undoRemove = async () => {
    if (!undo) return;
    await supabase.from("shopping_items").update({ deleted_at: null }).eq("id", undo.id);
    setUndo(null);
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

  const suggestions = useMemo(() => {
    const openNames = new Set(
      items.filter((item) => item.status === "open").map((item) => normalizeName(item.name))
    );
    return history.filter((entry) => !openNames.has(normalizeName(entry))).slice(0, 6);
  }, [history, items]);

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
            onChangeText={setName}
            onSubmitEditing={() => addItem()}
            returnKeyType="next"
            blurOnSubmit={false}
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

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 90 }}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={<Empty>Einkaufsliste ist leer.</Empty>}
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
                  color={bought ? colors.success : colors.subtext}
                />
              </TouchableOpacity>

              <TouchableOpacity style={{ flex: 1 }} onPress={() => toggleBought(item)}>
                <Text style={[styles.itemName, bought && styles.itemDone]}>{item.name}</Text>
              </TouchableOpacity>

              {!bought && (
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

      <UndoToast
        message={undo ? `„${undo.name}" gelöscht` : null}
        onUndo={undoRemove}
        onHide={() => setUndo(null)}
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

const styles = StyleSheet.create({
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
  },
  addButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    width: 46,
    justifyContent: "center",
    alignItems: "center",
  },
  hint: { fontSize: 13, color: colors.danger },
  suggestions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
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
  iconButton: { padding: 6 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: { backgroundColor: colors.card, borderRadius: 14, padding: 20, gap: 12 },
  modalTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
});
