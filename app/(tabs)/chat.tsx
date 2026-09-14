import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type AlertButton,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../src/lib/supabase";
import { hapticSuccess, hapticTap } from "../../src/lib/haptics";
import { useAuth } from "../../src/lib/AuthProvider";
import { useHousehold } from "../../src/lib/HouseholdProvider";
import { FORMER_MEMBER, useHouseholdMembers } from "../../src/lib/useHouseholdMembers";
import { makeStyles, useColors } from "../../src/lib/theme";
import { addDays, todayISO } from "../../src/lib/dates";
import { consumePollSent } from "../../src/lib/polls";
import { joinWithAnd } from "../../src/lib/text";
import { Chip } from "../../src/components/ui";
import { PollCard } from "../../src/components/PollCard";
import type { ChatKind, ChatMessage, ChatReceipt, PollVote } from "../../src/types/database";

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

const KIND_TITLE: Record<ChatKind, string> = {
  message: "Nachricht",
  request: "Bitte",
  announcement: "Aushang",
  poll: "Umfrage",
  event: "Ereignis",
};

/** Ältere offene Umfragen drängeln nicht mehr in der Leiste oben */
const POLL_NUDGE_DAYS = 14;

export default function ChatScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { members, loading: membersLoading } = useHouseholdMembers(activeHousehold?.id);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [receipts, setReceipts] = useState<ChatReceipt[]>([]);
  const [votes, setVotes] = useState<PollVote[]>([]);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<ChatKind>("message");
  const [expandedNotice, setExpandedNotice] = useState<string | null>(null);
  // Text, der beim Tippen auf „Umfrage" als Frage mitging
  const pollDraft = useRef<string | null>(null);
  const myId = session?.user.id;

  const nameFor = (userId: string) =>
    userId === myId ? "Du" : members.find((m) => m.id === userId)?.full_name ?? FORMER_MEMBER;

  // Ereignistexte kommen fertig konjugiert aus der Datenbank ("hat … erledigt").
  // Mit "Du" davor stünde dort "Du hat", darum immer der echte Name.
  const realNameFor = (userId: string) =>
    members.find((m) => m.id === userId)?.full_name ?? FORMER_MEMBER;

  const load = useCallback(async () => {
    if (!activeHousehold) return;

    // Die neuesten 200 Nachrichten — dazu Aushänge, die noch oben kleben, auch wenn
    // sie wegen vieler Ereigniskarten schon weiter zurückliegen
    const [latestResult, pinnedResult] = await Promise.all([
      supabase
        .from("chat_messages")
        .select("*")
        .eq("household_id", activeHousehold.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("chat_messages")
        .select("*")
        .eq("household_id", activeHousehold.id)
        .eq("kind", "announcement")
        .is("deleted_at", null)
        .gte("pinned_until", todayISO()),
    ]);

    if (latestResult.error) console.error(latestResult.error);
    const byId = new Map<string, ChatMessage>();
    for (const message of [...(latestResult.data ?? []), ...(pinnedResult.data ?? [])] as ChatMessage[]) {
      byId.set(message.id, message);
    }
    const loaded = [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));

    const announcementIds = loaded.filter((m) => m.kind === "announcement").map((m) => m.id);
    const pollIds = loaded.filter((m) => m.kind === "poll").map((m) => m.id);
    const [receiptResult, voteResult] = await Promise.all([
      announcementIds.length > 0
        ? supabase.from("chat_receipts").select("*").in("message_id", announcementIds)
        : Promise.resolve({ data: [] }),
      pollIds.length > 0
        ? supabase.from("chat_poll_votes").select("*").in("message_id", pollIds)
        : Promise.resolve({ data: [] }),
    ]);

    setMessages(loaded);
    setReceipts((receiptResult.data as ChatReceipt[]) ?? []);
    setVotes((voteResult.data as PollVote[]) ?? []);
  }, [activeHousehold]);

  useFocusEffect(
    useCallback(() => {
      load();
      // Zurück aus „Neue Umfrage": den mitgegebenen Entwurf nur nach dem Senden leeren
      const sent = consumePollSent();
      const draft = pollDraft.current;
      pollDraft.current = null;
      if (sent && draft) setText((current) => (current.trim() === draft ? "" : current));
    }, [load])
  );

  useEffect(() => {
    if (!activeHousehold) return;
    const householdId = activeHousehold.id;

    const channel = supabase
      .channel(`chat:${householdId}`)
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "chat_messages", filter: `household_id=eq.${householdId}` },
        (payload: any) => {
          // Bei DELETE ist `new` ein leeres Objekt, die id steht in `old`
          if (payload.eventType === "DELETE") {
            const id = payload.old?.id;
            setMessages((prev) => prev.filter((entry) => entry.id !== id));
            return;
          }
          const row = payload.new as ChatMessage;
          setMessages((prev) => {
            const without = prev.filter((entry) => entry.id !== row.id);
            if (row.deleted_at) return without;
            return [...without, row].sort((a, b) => a.created_at.localeCompare(b.created_at));
          });
        }
      )
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "chat_poll_votes", filter: `household_id=eq.${householdId}` },
        (payload: any) => {
          const row = payload.new as PollVote;
          if (!row?.message_id) return;
          setVotes((prev) => [
            ...prev.filter((vote) => !(vote.message_id === row.message_id && vote.user_id === row.user_id)),
            row,
          ]);
        }
      )
      .on(
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "chat_receipts" },
        (payload: any) => {
          const row = payload.new as ChatReceipt;
          setReceipts((prev) =>
            prev.some((receipt) => receipt.message_id === row.message_id && receipt.user_id === row.user_id)
              ? prev
              : [...prev, row]
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeHousehold]);

  /** Wer außer dem Verfasser den Aushang bestätigt hat */
  const seenBy = useCallback(
    (message: ChatMessage) =>
      members.filter(
        (member) =>
          member.id !== message.user_id &&
          receipts.some((receipt) => receipt.message_id === message.id && receipt.user_id === member.id)
      ),
    [members, receipts]
  );

  // Ein Aushang klebt für jeden oben, bis er „Verstanden" getippt hat. Wer ihn gemacht
  // hat, sieht ihn, bis alle anderen ihn gesehen haben. Spätestens nach 14 Tagen ist Schluss.
  const pinned = useMemo(() => {
    // Ohne Mitgliederliste sähe jeder eigene Aushang kurz nach „niemand sonst in der WG" aus
    if (membersLoading) return [];
    const today = todayISO();
    return messages.filter((message) => {
      if (message.kind !== "announcement" || !message.pinned_until || message.pinned_until < today) {
        return false;
      }
      const others = members.filter((member) => member.id !== message.user_id);
      if (message.user_id === myId) {
        return others.length === 0 || seenBy(message).length < others.length;
      }
      return !receipts.some((receipt) => receipt.message_id === message.id && receipt.user_id === myId);
    });
  }, [messages, members, membersLoading, receipts, myId, seenBy]);

  const openRequests = useMemo(
    () => messages.filter((message) => message.kind === "request" && message.done_at === null),
    [messages]
  );

  const pollsWaiting = useMemo(() => {
    const since = addDays(todayISO(), -POLL_NUDGE_DAYS);
    return messages.filter(
      (message) =>
        message.kind === "poll" &&
        message.poll_closed_at === null &&
        message.user_id !== myId &&
        message.created_at.slice(0, 10) >= since &&
        !votes.some((vote) => vote.message_id === message.id && vote.user_id === myId && vote.choices.length > 0)
    );
  }, [messages, votes, myId]);

  // Neueste unten, ohne bei jeder Änderung weiter oben ans Ende zu springen
  const newestFirst = useMemo(() => [...messages].reverse(), [messages]);

  const send = async () => {
    if (!session || !activeHousehold || !text.trim()) return;
    const content = text.trim();
    setText("");

    const { error } = await supabase.from("chat_messages").insert({
      household_id: activeHousehold.id,
      user_id: session.user.id,
      content,
      kind,
      // Aushänge kleben höchstens zwei Wochen oben
      pinned_until: kind === "announcement" ? addDays(todayISO(), 14) : null,
    });

    if (error) {
      setText(content);
      Alert.alert("Nachricht nicht gesendet", error.message);
      return;
    }
    hapticTap();
    setKind("message");
  };

  const startPoll = () => {
    const draft = text.trim();
    pollDraft.current = draft || null;
    router.push({ pathname: "/new-poll", params: draft ? { question: draft } : {} });
  };

  const confirmRead = async (message: ChatMessage) => {
    if (!myId) return;
    hapticTap();
    setReceipts((prev) => [...prev, { message_id: message.id, user_id: myId, read_at: new Date().toISOString() }]);
    const { error } = await supabase.from("chat_receipts").insert({ message_id: message.id, user_id: myId });
    if (error && !error.message.includes("duplicate")) {
      Alert.alert("Fehler", error.message);
      load();
    }
  };

  const unpin = async (message: ChatMessage) => {
    hapticTap();
    setMessages((prev) => prev.map((entry) => (entry.id === message.id ? { ...entry, pinned_until: null } : entry)));
    const { error } = await supabase.rpc("unpin_announcement", { p_message_id: message.id });
    if (error) {
      Alert.alert("Aushang nicht abgehängt", error.message);
      load();
    }
  };

  const claimRequest = async (message: ChatMessage) => {
    if (!session) return;
    hapticTap();
    await supabase
      .from("chat_messages")
      .update({ claimed_by: session.user.id })
      .eq("id", message.id);
    load();
  };

  const finishRequest = async (message: ChatMessage) => {
    hapticSuccess();
    await supabase
      .from("chat_messages")
      .update({ done_at: new Date().toISOString() })
      .eq("id", message.id);
    load();
  };

  const vote = async (message: ChatMessage, choices: number[]) => {
    if (!myId || !activeHousehold) return;
    hapticTap();
    setVotes((prev) => [
      ...prev.filter((entry) => !(entry.message_id === message.id && entry.user_id === myId)),
      {
        message_id: message.id,
        user_id: myId,
        household_id: activeHousehold.id,
        choices,
        updated_at: new Date().toISOString(),
      },
    ]);
    const { error } = await supabase.rpc("vote_poll", { p_message_id: message.id, p_choices: choices });
    if (error) {
      Alert.alert("Stimme nicht gespeichert", error.message);
      load();
    }
  };

  const closePoll = (message: ChatMessage) => {
    Alert.alert("Umfrage beenden?", "Danach kann niemand mehr abstimmen. Das Ergebnis bleibt im Chat.", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Beenden",
        onPress: async () => {
          setMessages((prev) =>
            prev.map((entry) =>
              entry.id === message.id ? { ...entry, poll_closed_at: new Date().toISOString() } : entry
            )
          );
          const { error } = await supabase.rpc("close_poll", { p_message_id: message.id });
          if (error) {
            Alert.alert("Umfrage nicht beendet", error.message);
            load();
            return;
          }
          hapticSuccess();
        },
      },
    ]);
  };

  const deleteMessage = async (message: ChatMessage) => {
    setMessages((prev) => prev.filter((entry) => entry.id !== message.id));
    const { error } = await supabase.from("chat_messages").delete().eq("id", message.id);
    if (error) {
      Alert.alert("Nicht gelöscht", error.message);
      load();
    }
  };

  // Langes Drücken auf eigene Nachrichten — wie in jedem Messenger
  const showActions = (message: ChatMessage) => {
    if (message.user_id !== myId || message.kind === "event") return;
    hapticTap();

    const buttons: AlertButton[] = [];
    if (message.kind === "poll" && message.poll_closed_at === null) {
      buttons.push({ text: "Umfrage beenden", onPress: () => closePoll(message) });
    }
    if (message.kind === "announcement" && pinned.some((entry) => entry.id === message.id)) {
      buttons.push({ text: "Abhängen", onPress: () => unpin(message) });
    }
    buttons.push({ text: "Für alle löschen", style: "destructive", onPress: () => deleteMessage(message) });
    buttons.push({ text: "Abbrechen", style: "cancel" });

    const preview = message.content.length > 80 ? `${message.content.slice(0, 79)}…` : message.content;
    Alert.alert(KIND_TITLE[message.kind], preview, buttons);
  };

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

    if (item.kind === "poll") {
      return (
        <PollCard
          message={item}
          votes={votes.filter((entry) => entry.message_id === item.id)}
          members={members}
          myId={myId}
          nameFor={nameFor}
          onVote={(choices) => vote(item, choices)}
          onClose={() => closePoll(item)}
          onLongPress={() => showActions(item)}
        />
      );
    }

    const mine = item.user_id === myId;

    if (item.kind === "request") {
      const claimed = item.claimed_by !== null;
      const done = item.done_at !== null;
      return (
        <TouchableOpacity activeOpacity={0.8} disabled={!mine} onLongPress={() => showActions(item)}>
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
                  {item.claimed_by === myId ? "Du machst das" : `${nameFor(item.claimed_by!)} macht das`}
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
        </TouchableOpacity>
      );
    }

    const isAnnouncement = item.kind === "announcement";
    const others = members.filter((member) => member.id !== item.user_id).length;
    return (
      <View style={[styles.bubbleRow, mine && !isAnnouncement && { alignItems: "flex-end" }]}>
        {!mine && !isAnnouncement && <Text style={styles.sender}>{nameFor(item.user_id)}</Text>}
        <TouchableOpacity
          activeOpacity={0.8}
          disabled={!mine}
          onLongPress={() => showActions(item)}
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
          {isAnnouncement && others > 0 && (
            <Text style={styles.announcementMeta}>
              {seenBy(item).length === others ? "✓ Alle haben es gesehen" : `${seenBy(item).length} von ${others} gesehen`}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  const noticeMeta = (message: ChatMessage) => {
    const others = members.filter((member) => member.id !== message.user_id);
    const seen = seenBy(message);
    if (message.user_id !== myId) {
      return `${nameFor(message.user_id)} · ${seen.length} von ${others.length} haben es gesehen`;
    }
    if (others.length === 0) return "Noch niemand sonst in der WG";
    const missing = others.filter((member) => !seen.includes(member)).map((member) => nameFor(member.id));
    return missing.length <= 2
      ? `${joinWithAnd(missing)} ${missing.length === 1 ? "hat" : "haben"} es noch nicht gesehen`
      : `${seen.length} von ${others.length} haben es gesehen`;
  };

  const openHints = [
    openRequests.length > 0 && `${openRequests.length} offene ${openRequests.length === 1 ? "Bitte" : "Bitten"}`,
    pollsWaiting.length > 0 &&
      (pollsWaiting.length === 1 ? "1 Umfrage wartet auf dich" : `${pollsWaiting.length} Umfragen warten auf dich`),
  ].filter(Boolean);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {pinned.map((message) => {
        const mine = message.user_id === myId;
        const expanded = expandedNotice === message.id;
        return (
          <TouchableOpacity
            key={message.id}
            activeOpacity={0.9}
            style={styles.pinnedBar}
            onPress={() => setExpandedNotice(expanded ? null : message.id)}
            onLongPress={() => showActions(message)}
          >
            <Ionicons name="pin" size={16} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={styles.pinnedText} numberOfLines={expanded ? undefined : 3}>
                {message.content}
              </Text>
              <Text style={styles.pinnedMeta}>{noticeMeta(message)}</Text>
            </View>
            {mine ? (
              <TouchableOpacity style={styles.pinnedButton} onPress={() => unpin(message)}>
                <Text style={styles.pinnedButtonText}>Abhängen</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.pinnedButton} onPress={() => confirmRead(message)}>
                <Text style={styles.pinnedButtonText}>Verstanden</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        );
      })}

      {openHints.length > 0 && (
        <View style={styles.openBar}>
          <Ionicons name={pollsWaiting.length > 0 ? "stats-chart" : "hand-left"} size={14} color={colors.tint} />
          <Text style={styles.openText}>{openHints.join(" · ")}</Text>
        </View>
      )}

      <FlatList
        data={newestFirst}
        inverted
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        renderItem={({ item }) => renderMessage(item)}
      />

      <View style={styles.composer}>
        <View style={styles.kindRow}>
          <Chip label="Nachricht" selected={kind === "message"} onPress={() => setKind("message")} compact />
          <Chip label="Bitte" selected={kind === "request"} onPress={() => setKind("request")} compact />
          <Chip
            label="Aushang"
            selected={kind === "announcement"}
            onPress={() => setKind("announcement")}
            compact
          />
          <Chip label="Umfrage" selected={false} onPress={startPoll} compact />
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

const useStyles = makeStyles((colors) => ({
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
  openText: { fontSize: 13, color: colors.tint, fontWeight: "600" },
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
  announcementLabel: { fontSize: 11, fontWeight: "700", color: colors.tint, marginBottom: 4 },
  announcementMeta: { fontSize: 12, color: colors.subtext, marginTop: 6 },
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
  kindRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
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
}));
