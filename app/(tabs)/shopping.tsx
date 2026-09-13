import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/lib/AuthProvider";
import { useHousehold } from "../../src/lib/HouseholdProvider";
import { colors } from "../../src/lib/theme";
import type { ShoppingItem } from "../../src/types/database";

export default function ShoppingScreen() {
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    if (!activeHousehold) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("shopping_items")
      .select("*")
      .eq("household_id", activeHousehold.id)
      .order("created_at", { ascending: false });

    if (error) console.error(error);
    setItems(data ?? []);
    setLoading(false);
  }, [activeHousehold]);

  useEffect(() => {
    load();
    if (!activeHousehold) return;

    const channel = supabase
      .channel(`shopping_items:${activeHousehold.id}`)
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "shopping_items", filter: `household_id=eq.${activeHousehold.id}` },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeHousehold, load]);

  const addItem = async () => {
    if (!session || !activeHousehold || !name.trim()) return;
    await supabase
      .from("shopping_items")
      .insert({ household_id: activeHousehold.id, name: name.trim(), added_by: session.user.id });
    setName("");
    load();
  };

  const toggleBought = async (item: ShoppingItem) => {
    if (!session) return;
    if (item.status === "open") {
      await supabase
        .from("shopping_items")
        .update({ status: "bought", bought_by: session.user.id, bought_at: new Date().toISOString() })
        .eq("id", item.id);
    } else {
      await supabase
        .from("shopping_items")
        .update({ status: "open", bought_by: null, bought_at: null })
        .eq("id", item.id);
    }
    load();
  };

  const removeItem = async (item: ShoppingItem) => {
    await supabase.from("shopping_items").delete().eq("id", item.id);
    load();
  };

  return (
    <View style={styles.container}>
      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          placeholder="Was fehlt?"
          value={name}
          onChangeText={setName}
          onSubmitEditing={addItem}
          returnKeyType="done"
        />
        <TouchableOpacity style={styles.addButton} onPress={addItem}>
          <Text style={styles.addButtonText}>Hinzufügen</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 20 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          ListEmptyComponent={<Text style={styles.empty}>Einkaufsliste ist leer.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => toggleBought(item)} onLongPress={() => removeItem(item)}>
              <Text style={styles.checkbox}>{item.status === "bought" ? "☑" : "☐"}</Text>
              <Text
                style={[
                  styles.itemText,
                  item.status === "bought" && { textDecorationLine: "line-through", color: colors.subtext },
                ]}
              >
                {item.name}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  addRow: { flexDirection: "row", padding: 16, gap: 8 },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  addButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  addButtonText: { color: "#fff", fontWeight: "600" },
  empty: { textAlign: "center", color: colors.subtext, marginTop: 20 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  checkbox: { fontSize: 18 },
  itemText: { fontSize: 15, color: colors.text },
});
