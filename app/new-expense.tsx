import { useState } from "react";
import { router } from "expo-router";
import { supabase } from "../src/lib/supabase";
import { useAuth } from "../src/lib/AuthProvider";
import { useHousehold } from "../src/lib/HouseholdProvider";
import { useHouseholdMembers } from "../src/lib/useHouseholdMembers";
import { ExpenseForm, type ExpenseFormValues } from "../src/components/ExpenseForm";
import { ErrorText, Loading } from "../src/components/ui";

export default function NewExpense() {
  const { session } = useAuth();
  const { activeHousehold } = useHousehold();
  const { members, loading } = useHouseholdMembers(activeHousehold?.id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading || !session || !activeHousehold) return <Loading />;

  const save = async (values: ExpenseFormValues) => {
    setSaving(true);
    const { error: rpcError } = await supabase.rpc("create_expense", {
      p_household_id: activeHousehold.id,
      p_title: values.title,
      p_amount_cents: values.amount_cents,
      p_paid_by: values.paid_by,
      p_shares: values.shares,
      p_split_mode: values.split_mode,
      p_category: values.category,
      p_note: values.note,
    });
    setSaving(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/expenses");
  };

  return (
    <>
      {error && <ErrorText>{error}</ErrorText>}
      <ExpenseForm
        members={members}
        currentUserId={session.user.id}
        submitLabel="Ausgabe speichern"
        saving={saving}
        onSubmit={save}
      />
    </>
  );
}
