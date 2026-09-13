import { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/lib/AuthProvider";
import { useHousehold } from "../../src/lib/HouseholdProvider";
import { useHouseholdMembers } from "../../src/lib/useHouseholdMembers";
import { colors } from "../../src/lib/theme";
import type { ChatMessage } from "../../src/types/database";

export default function ChatScreen() {
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const listRef = useRef<FlatList>(null);

  const nameFor = (userId: string) => members.find((m) => m.id === userId)?.full_name ?? "?";

  const load = useCallback(async () => {
    if (!activeHousehold) return;
    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("household_id", activeHousehold.id)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) console.error(error);
    setMessages(data ?? []);
  }, [activeHousehold]);

  useEffect(() => {
    load();
    if (!activeHousehold) return;

    const channel = supabase
      .channel(`chat_messages:${activeHousehold.id}`)
      .on(
        "postgres_changes" as any,
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `household_id=eq.${activeHousehold.id}`,
        },
        (payload: any) => {
          setMessages((prev) => [...prev, payload.new as ChatMessage]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeHousehold, load]);

  const send = async () => {
    if (!session || !activeHousehold || !text.trim()) return;
    const content = text.trim();
    setText("");
    await supabase
      .from("chat_messages")
      .insert({ household_id: activeHousehold.id, user_id: session.user.id, content });
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => {
          const mine = item.user_id === session?.user.id;
          return (
            <View style={[styles.bubbleRow, mine && { alignItems: "flex-end" }]}>
              {!mine && <Text style={styles.sender}>{nameFor(item.user_id)}</Text>}
              <View style={[styles.bubble, mine && styles.bubbleMine]}>
                <Text style={[styles.bubbleText, mine && { color: "#fff" }]}>{item.content}</Text>
              </View>
            </View>
          );
        }}
      />
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Nachricht..."
          value={text}
          onChangeText={setText}
          onSubmitEditing={send}
        />
        <TouchableOpacity style={styles.sendButton} onPress={send}>
          <Text style={styles.sendButtonText}>Senden</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
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
  bubbleText: { fontSize: 15, color: colors.text },
  inputRow: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    backgroundColor: colors.card,
  },
  input: {
    flex: 1,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
  },
  sendButton: {
    backgroundColor: colors.primary,
    borderRadius: 20,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  sendButtonText: { color: "#fff", fontWeight: "600" },
});
