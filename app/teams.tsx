import { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { supabase } from "../src/lib/supabase";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { useHouseholdMembers } from "../src/lib/useHouseholdMembers";
import { useTeams } from "../src/lib/useTeams";
import { colors } from "../src/lib/theme";
import { Button, Card, Chip, Empty, Input, Loading, Muted, SectionTitle } from "../src/components/ui";

export default function TeamsScreen() {
  const { activeHousehold } = useHousehold();
  const { members } = useHouseholdMembers(activeHousehold?.id);
  const { teams, loading, refresh } = useTeams(activeHousehold?.id);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const createTeam = async () => {
    if (!activeHousehold || !name.trim()) return;
    setSaving(true);
    const { error } = await supabase
      .from("teams")
      .insert({ household_id: activeHousehold.id, name: name.trim() });
    setSaving(false);

    if (error) {
      Alert.alert("Fehler", error.message);
      return;
    }
    setName("");
    refresh();
  };

  const toggleMember = async (teamId: string, userId: string, isMember: boolean) => {
    const { error } = isMember
      ? await supabase.from("team_members").delete().eq("team_id", teamId).eq("user_id", userId)
      : await supabase.from("team_members").insert({ team_id: teamId, user_id: userId });

    if (error) {
      Alert.alert("Fehler", error.message);
      return;
    }
    refresh();
  };

  const deleteTeam = (teamId: string, teamName: string) => {
    Alert.alert("Team löschen", `„${teamName}" wirklich löschen?`, [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Löschen",
        style: "destructive",
        onPress: async () => {
          const { error } = await supabase.from("teams").delete().eq("id", teamId);
          if (error) Alert.alert("Fehler", error.message);
          refresh();
        },
      },
    ]);
  };

  if (loading) return <Loading />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <SectionTitle>Neues Team</SectionTitle>
      <View style={styles.addRow}>
        <Input
          style={{ flex: 1 }}
          placeholder="z.B. Küchen-Crew"
          value={name}
          onChangeText={setName}
        />
        <Button title="Anlegen" onPress={createTeam} loading={saving} />
      </View>
      <Muted>
        Teams kannst du bei einer Aufgabe reihum zuteilen — dann ist immer das ganze Team dran.
      </Muted>

      <SectionTitle>Teams</SectionTitle>
      {teams.length === 0 && <Empty>Noch keine Teams angelegt.</Empty>}

      {teams.map((team) => (
        <Card key={team.id}>
          <View style={styles.teamHeader}>
            <Text style={styles.teamName}>{team.name}</Text>
            <Text style={styles.delete} onPress={() => deleteTeam(team.id, team.name)}>
              Löschen
            </Text>
          </View>
          <Muted>Mitglieder antippen, um sie hinzuzufügen oder zu entfernen.</Muted>
          <View style={styles.chipWrap}>
            {members.map((member) => {
              const isMember = team.member_ids.includes(member.id);
              return (
                <Chip
                  key={member.id}
                  label={member.full_name}
                  selected={isMember}
                  onPress={() => toggleMember(team.id, member.id, isMember)}
                />
              );
            })}
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  addRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  teamHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  teamName: { fontSize: 16, fontWeight: "700", color: colors.text },
  delete: { color: colors.danger, fontSize: 13, fontWeight: "600" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
});
