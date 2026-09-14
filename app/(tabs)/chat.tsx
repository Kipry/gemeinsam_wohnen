import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router } from "expo-router";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
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
import { useHouseholdMembers } from "../../src/lib/useHouseholdMembers";
import { colors } from "../../src/lib/theme";
import { addDays, todayISO } from "../../src/lib/dates";
import { Chip } from "../../src/components/ui";
import type { ChatKind, ChatMessage, ChatReceipt } from "../../src/types/database";

const EVENT_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  task_occurrences: "sparkles",
  expenses: "cash",
  absences: "airplane",
  calendar_events: "calendar",
};

const EVENT_ROUTE: Record<string, (id: string) => string> = {
  expenses: (id) => `/expense/${id}`,
  calendar_events: (id) => `/event/${id}`,
  absences: () => "/(tabs)/calendar",
};

export default function ChatScreen() {
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [receipts, setReceipts] = useState<ChatReceipt[]>([]);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<ChatKind>("message");
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const nameFor = (userId: string) =>
    userId === session?.user.id ? "Du" : members.find((m) => m.id === userId)?.full_name ?? "?";

  // Ereignistexte kommen fertig konjugiert aus der Datenbank ("hat … erledigt").
  // Mit "Du" davor stünde dort "Du hat", darum immer der echte Name.
  const realNameFor = (userId: string) =>
    members.find((m) => m.id === userId)?.full_name ?? "?";

  const load = useCallback(async () => {
    if (!activeHousehold) return;

    const [messageResult, receiptResult] = await Promise.all([
      supabase
        .from("chat_messages")
        .select("*")
        .eq("household_id", activeHousehold.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(200),
      supabase.from("chat_receipts").select("*"),
    ]);

    if (messageResult.error) console.error(messageResult.error);
    setMessages((messageResult.data as ChatMessage[]) ?? []);
    setReceipts((receiptResult.data as ChatReceipt[]) ?? []);
  }, [activeHousehold]);

  useEffect(() => {
    load();
    if (!activeHousehold) return;

    const channel = supabase
      .channel(`chat_messages:${activeHousehold.id}`)
      .on(
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "chat_messages",
          filter: `household_id=eq.${activeHousehold.id}`,
        },
        (payload: any) => {
          const row = (payload.new ?? payload.old) as ChatMessage;
          setMessages((prev) => {
            const without = prev.filter((entry) => entry.id !== row.id);
            if (payload.eventType === "DELETE" || row.deleted_at) return without;
            return [...without, row].sort((a, b) => a.created_at.localeCompare(b.created_at));
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeHousehold, load]);

  const pinned = useMemo(
    () =>
      messages.filter(
        (message) =>
          message.kind === "announcement" &&
          message.pinned_until !== null &&
          message.pinned_until >= todayISO()
      ),
    [messages]
  );

  const openRequests = useMemo(
    () => messages.filter((message) => message.kind === "request" && message.done_at === null),
    [messages]
  );

  const send = async () => {
    if (!session || !activeHousehold || !text.trim()) return;
    const content = text.trim();
    setText("");

    const { error } = await supabase.from("chat_messages").insert({
      household_id: activeHousehold.id,
      user_id: session.user.id,
      content,
      kind,
      // Aushänge kleben zwei Wochen oben
      pinned_until: kind === "announcement" ? addDays(todayISO(), 14) : null,
    });

    if (error) {
      setText(content);
      Alert.alert("Nachricht nicht gesendet", error.message);
      return;
    }
    setKind("message");
  };

  const confirmRead = async (message: ChatMessage) => {
    if (!session) return;
    const { error } = await supabase
      .from("chat_receipts")
      .insert({ message_id: message.id, user_id: session.user.id });
    if (error && !error.message.includes("duplicate")) {
      Alert.alert("Fehler", error.message);
      return;
    }
    load();
  };

  const claimRequest = async (message: ChatMessage) => {
    if (!session) return;
    await supabase
      .from("chat_messages")
      .update({ claimed_by: session.user.id })
      .eq("id", message.id);
    load();
  };

  const finishRequest = async (message: ChatMessage) => {
    await supabase
      .from("chat_messages")
      .update({ done_at: new Date().toISOString() })
      .eq("id", message.id);
    load();
  };

  const readersOf = (messageId: string) =>
    receipts.filter((receipt) => receipt.message_id === messageId);

  const renderMessage = (item: ChatMessage) => {
    if (item.kind === "event") {
      const icon = EVENT_ICON[item.ref_table ?? ""] ?? "ellipse";
      const route = item.ref_table ? EVENT_ROUTE[item.ref_table] : undefined;
      return (
        <TouchableOpacity
          disabled={!route || !item.ref_id}
          onPress={() => route && item.ref_id && router.push(route(item.ref_id) as any)}
        >
          <View style={styles.eventCard}>
            <Ionicons name={icon} size={15} color={colors.subtext} />
            <Text style={styles.eventText}>
              {realNameFor(item.user_id)} {item.content}
            </Text>
          </View>
        </TouchableOpacity>
      );
    }

    if (item.kind === "request") {
      const claimed = item.claimed_by !== null;
      const done = item.done_at !== null;
      return (
        <View style={[styles.requestCard, done && styles.requestDone]}>
          <Text style={styles.requestLabel}>BITTE · {nameFor(item.user_id)}</Text>
          <Text style={styles.requestText}>{item.content}</Text>
          {done ? (
            <Text style={styles.requestStatus}>
              ✓ erledigt von {claimed ? nameFor(item.claimed_by!) : "jemandem"}
            </Text>
          ) : claimed ? (
            <View style={styles.requestRow}>
              <Text style={styles.requestStatus}>
                {item.claimed_by === session?.user.id
                  ? "Du machst das"
                  : `${nameFor(item.claimed_by!)} macht das`}
              </Text>
              <TouchableOpacity style={styles.smallButton} onPress={() => finishRequest(item)}>
                <Text style={styles.smallButtonText}>Erledigt</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.smallButton} onPress={() => claimRequest(item)}>
              <Text style={styles.smallButtonText}>Mach ich</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }

    const mine = item.user_id === session?.user.id;
    const isAnnouncement = item.kind === "announcement";
    return (
      <View style={[styles.bubbleRow, mine && !isAnnouncement && { alignItems: "flex-end" }]}>
        {!mine && !isAnnouncement && <Text style={styles.sender}>{nameFor(item.user_id)}</Text>}
        <View
          style={[
            styles.bubble,
            mine && !isAnnouncement && styles.bubbleMine,
            isAnnouncement && styles.bubbleAnnouncement,
          ]}
        >
          {isAnnouncement && (
            <Text style={styles.announcementLabel}>AUSHANG · {nameFor(item.user_id)}</Text>
          )}
          <Text style={[styles.bubbleText, mine && !isAnnouncement && { color: "#fff" }]}>
            {item.content}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {pinned.map((message) => {
        const readers = readersOf(message.id);
        const iRead = readers.some((receipt) => receipt.user_id === session?.user.id);
        return (
          <View key={message.id} style={styles.pinnedBar}>
            <Ionicons name="pin" size={16} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={styles.pinnedText}>{message.content}</Text>
              <Text style={styles.pinnedMeta}>
                {readers.length} von {members.length} haben es gesehen
              </Text>
            </View>
            {!iRead && (
              <TouchableOpacity style={styles.pinnedButton} onPress={() => confirmRead(message)}>
                <Text style={styles.pinnedButtonText}>Verstanden</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}

      {openRequests.length > 0 && (
        <View style={styles.openBar}>
          <Ionicons name="hand-left" size={14} color={colors.primary} />
          <Text style={styles.openText}>
            {openRequests.length} offene {openRequests.length === 1 ? "Bitte" : "Bitten"}
          </Text>
        </View>
      )}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => renderMessage(item)}
      />

      <View style={styles.composer}>
        <View style={styles.kindRow}>
          <Chip label="Nachricht" selected={kind === "message"} onPress={() => setKind("message")} />
          <Chip label="Bitte" selected={kind === "request"} onPress={() => setKind("request")} />
          <Chip
            label="Aushang"
            selected={kind === "announcement"}
            onPress={() => setKind("announcement")}
          />
        </View>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder={
              kind === "request"
                ? "Worum bittest du?"
                : kind === "announcement"
                  ? "Was müssen alle wissen?"
                  : "Nachricht..."
            }
            placeholderTextColor={colors.subtext}
            value={text}
            onChangeText={setText}
            onSubmitEditing={send}
          />
          <TouchableOpacity style={styles.sendButton} onPress={send}>
            <Text style={styles.sendButtonText}>Senden</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  pinnedBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  pinnedText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  pinnedMeta: { color: "#fff", fontSize: 11, opacity: 0.85, marginTop: 2 },
  pinnedButton: { backgroundColor: "#fff", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  pinnedButtonText: { color: colors.primary, fontWeight: "700", fontSize: 12 },
  openBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  openText: { fontSize: 13, color: colors.primary, fontWeight: "600" },
  bubbleRow: { gap: 2 },
  sender: { fontSize: 12, color: colors.subtext, marginLeft: 4 },
  bubble: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: "80%",
  },
  bubbleMine: { backgroundColor: colors.primary, borderColor: colors.primary },
  bubbleAnnouncement: {
    maxWidth: "100%",
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.card,
  },
  announcementLabel: { fontSize: 11, fontWeight: "700", color: colors.primary, marginBottom: 4 },
  bubbleText: { fontSize: 15, color: colors.text },
  eventCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  eventText: { flex: 1, fontSize: 13, color: colors.subtext },
  requestCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
    gap: 6,
  },
  requestDone: { opacity: 0.6 },
  requestLabel: { fontSize: 11, fontWeight: "700", color: colors.subtext },
  requestText: { fontSize: 15, color: colors.text },
  requestRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  requestStatus: { flex: 1, fontSize: 13, color: colors.subtext },
  smallButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: "flex-start",
  },
  smallButtonText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  composer: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    backgroundColor: colors.card,
    padding: 12,
    gap: 8,
  },
  kindRow: { flexDirection: "row", gap: 8 },
  inputRow: { flexDirection: "row", gap: 8 },
  input: {
    flex: 1,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
  },
  sendButton: {
    backgroundColor: colors.primary,
    borderRadius: 20,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  sendButtonText: { color: "#fff", fontWeight: "600" },
});
