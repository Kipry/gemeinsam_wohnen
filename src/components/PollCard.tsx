import { Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles, useColors } from "../lib/theme";
import { tallyPoll } from "../lib/polls";
import { joinWithAnd } from "../lib/text";
import type { ChatMessage, PollVote, Profile } from "../types/database";

export function PollCard({
  message,
  votes,
  members,
  myId,
  nameFor,
  onVote,
  onClose,
  onLongPress,
}: {
  message: ChatMessage;
  /** Nur die Stimmen dieser Umfrage */
  votes: PollVote[];
  members: Profile[];
  myId: string | undefined;
  nameFor: (userId: string) => string;
  onVote: (choices: number[]) => void;
  onClose: () => void;
  onLongPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const options = message.poll_options ?? [];
  const closed = message.poll_closed_at !== null;
  const mine = message.user_id === myId;
  const { votersByOption, voters } = tallyPoll(options.length, votes);
  const myChoices = votes.find((vote) => vote.user_id === myId)?.choices ?? [];
  const most = Math.max(0, ...votersByOption.map((list) => list.length));

  const toggle = (index: number) => {
    if (closed) return;
    const chosen = myChoices.includes(index);
    const next = message.poll_multiple
      ? chosen
        ? myChoices.filter((choice) => choice !== index)
        : [...myChoices, index].sort((a, b) => a - b)
      : chosen
        ? []
        : [index];
    onVote(next);
  };

  const missingOthers = members
    .filter((member) => member.id !== myId && !voters.has(member.id))
    .map((member) => nameFor(member.id));
  const iAmMissing = members.some((member) => member.id === myId) && !voters.has(myId ?? "");

  let status: string;
  if (closed) {
    status = voters.size === 1 ? "Beendet · 1 Stimme" : `Beendet · ${voters.size} Stimmen`;
  } else if (missingOthers.length === 0) {
    status = iAmMissing ? "Nur deine Stimme fehlt noch" : "Alle haben abgestimmt";
  } else if (missingOthers.length <= 2) {
    const names = iAmMissing ? [...missingOthers, "du"] : missingOthers;
    status = `${voters.size} von ${members.length} · fehlt noch: ${joinWithAnd(names)}`;
  } else {
    status = `${voters.size} von ${members.length} haben abgestimmt`;
  }

  return (
    <TouchableOpacity activeOpacity={1} onLongPress={onLongPress} delayLongPress={350}>
      <View style={styles.card}>
        <View style={styles.labelRow}>
          <Ionicons name="stats-chart" size={12} color={colors.subtext} />
          <Text style={styles.label}>UMFRAGE · {nameFor(message.user_id)}</Text>
        </View>
        <Text style={styles.question}>{message.content}</Text>
        {message.poll_multiple && !closed && <Text style={styles.hint}>Mehrere Antworten möglich</Text>}

        <View style={styles.options}>
          {options.map((option, index) => {
            const chosenBy = votersByOption[index] ?? [];
            const checked = myChoices.includes(index);
            const winner = closed && chosenBy.length > 0 && chosenBy.length === most;
            const share = voters.size > 0 ? chosenBy.length / voters.size : 0;
            const icon = message.poll_multiple
              ? checked
                ? "checkbox"
                : "square-outline"
              : checked
                ? "radio-button-on"
                : "radio-button-off";

            return (
              <TouchableOpacity
                key={index}
                disabled={closed}
                onPress={() => toggle(index)}
                onLongPress={onLongPress}
                style={[styles.option, checked && styles.optionChecked]}
                accessibilityRole={message.poll_multiple ? "checkbox" : "radio"}
                accessibilityState={{ checked, disabled: closed }}
                accessibilityLabel={`${option}, ${chosenBy.length} ${chosenBy.length === 1 ? "Stimme" : "Stimmen"}`}
              >
                <View style={styles.optionRow}>
                  {closed ? (
                    <Ionicons
                      name={winner ? "trophy" : checked ? "checkmark" : "ellipse-outline"}
                      size={18}
                      color={winner ? colors.warning : checked ? colors.tint : colors.border}
                    />
                  ) : (
                    <Ionicons name={icon} size={20} color={checked ? colors.tint : colors.subtext} />
                  )}
                  <View style={styles.optionBody}>
                    <View style={styles.labelLine}>
                      <Text style={[styles.optionLabel, winner && styles.optionWinner]}>{option}</Text>
                      <Text style={[styles.count, winner && styles.optionWinner]}>{chosenBy.length}</Text>
                    </View>
                    {/* Anteil der Abstimmenden — schmal unter dem Text, damit nie Schrift auf Farbe steht */}
                    <View style={styles.track}>
                      <View style={[styles.bar, { width: `${Math.round(share * 100)}%` }]} />
                    </View>
                    {chosenBy.length > 0 && (
                      <Text style={styles.voters} numberOfLines={2}>
                        {chosenBy.map(nameFor).join(", ")}
                      </Text>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.footer}>
          <Text style={styles.status}>{status}</Text>
          {mine && !closed && (
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Text style={styles.closeLink}>Beenden</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
    gap: 6,
  },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  label: { fontSize: 11, fontWeight: "700", color: colors.subtext },
  question: { fontSize: 16, fontWeight: "600", color: colors.text },
  hint: { fontSize: 12, color: colors.subtext },
  options: { gap: 6, marginTop: 4 },
  option: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  optionChecked: { borderColor: colors.tint },
  optionRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 10, paddingVertical: 9 },
  optionBody: { flex: 1, gap: 5 },
  labelLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  optionLabel: { flex: 1, fontSize: 15, color: colors.text },
  optionWinner: { fontWeight: "700" },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: "hidden" },
  bar: { height: 4, borderRadius: 2, backgroundColor: colors.tint },
  voters: { fontSize: 12, color: colors.subtext },
  count: { fontSize: 14, color: colors.subtext, minWidth: 16, textAlign: "right" },
  footer: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2 },
  status: { flex: 1, fontSize: 12, color: colors.subtext },
  closeLink: { fontSize: 13, fontWeight: "600", color: colors.tint },
}));
