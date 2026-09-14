import { useState } from "react";
import { Modal, Platform, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles, useColors } from "../lib/theme";
import { hapticTap } from "../lib/haptics";
import { normalizeName } from "../lib/shoppingCategories";
import type { PastedItem } from "../lib/pastedList";
import { Button } from "./ui";

/**
 * Auswahl nach dem Einfügen einer Liste. Rezepte enthalten fast immer Dinge,
 * die schon im Schrank stehen — die tippt man hier einfach weg.
 */
export function PastedListSheet({
  items,
  alreadyOnList,
  onCancel,
  onAdd,
}: {
  items: PastedItem[] | null;
  /** Normalisierte Namen, die offen auf der Liste stehen */
  alreadyOnList: Set<string>;
  onCancel: () => void;
  onAdd: (items: PastedItem[]) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [selection, setSelection] = useState<{ source: PastedItem[] | null; values: boolean[] }>({
    source: null,
    values: [],
  });

  // Nur bei einer neu eingefügten Liste vorbelegen — schon im ersten Bild, ohne Flackern
  let selected = selection.values;
  if (items && selection.source !== items) {
    selected = items.map((item) => item.likely && !alreadyOnList.has(normalizeName(item.name)));
    setSelection({ source: items, values: selected });
  }

  const count = selected.filter(Boolean).length;

  const toggle = (index: number) => {
    hapticTap();
    setSelection((prev) => ({ ...prev, values: prev.values.map((value, i) => (i === index ? !value : value)) }));
  };

  const setAll = (value: boolean) =>
    setSelection((prev) => ({ ...prev, values: prev.values.map(() => value) }));

  return (
    <Modal
      visible={items !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onCancel}
    >
      <View
        style={[
          styles.container,
          { paddingTop: Platform.OS === "ios" ? 0 : insets.top, paddingBottom: Math.max(insets.bottom, 16) },
        ]}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel} style={styles.headerSide}>
            <Text style={styles.cancel}>Abbrechen</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Liste übernehmen</Text>
          <View style={styles.headerSide} />
        </View>

        <View style={styles.hintRow}>
          <Text style={styles.hint}>Was ihr schon habt, einfach abwählen.</Text>
          <TouchableOpacity onPress={() => setAll(count === 0)}>
            <Text style={styles.link}>{count === 0 ? "Alle wählen" : "Keine"}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.list}>
          {(items ?? []).map((item, index) => {
            const checked = selected[index] ?? false;
            const already = alreadyOnList.has(normalizeName(item.name));
            return (
              <TouchableOpacity
                key={`${item.name}-${index}`}
                style={styles.row}
                onPress={() => toggle(index)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
              >
                <Ionicons
                  name={checked ? "checkmark-circle" : "ellipse-outline"}
                  size={24}
                  color={checked ? colors.tint : colors.subtext}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, !checked && styles.nameOff]}>{item.name}</Text>
                  {already && <Text style={styles.note}>steht schon auf der Liste</Text>}
                </View>
                {item.quantity && <Text style={styles.quantity}>{item.quantity}</Text>}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.footer}>
          <Button
            title={count === 0 ? "Nichts ausgewählt" : `${count} Artikel hinzufügen`}
            disabled={count === 0}
            onPress={() => items && onAdd(items.filter((_, index) => selected[index]))}
          />
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  headerSide: { width: 90 },
  cancel: { fontSize: 16, color: colors.tint },
  title: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "700", color: colors.text },
  hintRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  hint: { fontSize: 13, color: colors.subtext },
  link: { fontSize: 14, fontWeight: "600", color: colors.tint },
  list: { paddingHorizontal: 16, paddingBottom: 16, gap: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  name: { fontSize: 15, color: colors.text },
  nameOff: { color: colors.subtext },
  note: { fontSize: 12, color: colors.subtext, marginTop: 2 },
  quantity: { fontSize: 13, color: colors.subtext },
  footer: { paddingHorizontal: 16, paddingTop: 8 },
}));
