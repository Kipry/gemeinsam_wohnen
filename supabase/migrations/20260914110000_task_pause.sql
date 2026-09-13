-- Pausieren/Fortsetzen einer Aufgabe. Der Client kann generate_occurrence
-- nicht selbst aufrufen (bewusst gesperrt), deshalb eine eigene Funktion:
-- beim Pausieren fallen offene Termine weg, beim Fortsetzen entsteht einer neu.
create function public.set_task_active(p_task_id uuid, p_active boolean)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where id = p_task_id;
  if not found then
    raise exception 'Aufgabe nicht gefunden';
  end if;

  if not public.is_household_member(t.household_id) then
    raise exception 'Keine Berechtigung';
  end if;

  update public.tasks set active = p_active where id = t.id returning * into t;

  delete from public.task_occurrences where task_id = t.id and status = 'open';

  if p_active then
    perform public.generate_occurrence(t.id, current_date, null);
  end if;

  return t;
end;
$$;

revoke all on function public.set_task_active(uuid, boolean) from public, anon;
grant execute on function public.set_task_active(uuid, boolean) to authenticated;

-- update_expense setzte das Datum auf heute, wenn der Aufrufer es wegließ.
-- Mit null als Vorgabe bleibt das bestehende Datum erhalten.
create or replace function public.update_expense(
  p_expense_id uuid,
  p_title text,
  p_amount_cents bigint,
  p_paid_by uuid,
  p_shares jsonb,
  p_split_mode text default 'equal',
  p_category text default null,
  p_expense_date date default null,
  p_note text default null
)
returns public.expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.expenses;
begin
  select * into e from public.expenses where id = p_expense_id and deleted_at is null;
  if not found then
    raise exception 'Ausgabe nicht gefunden';
  end if;

  perform public.assert_expense_input(e.household_id, p_amount_cents, p_paid_by, p_shares);

  update public.expenses
  set title = trim(p_title),
      amount_cents = p_amount_cents,
      paid_by = p_paid_by,
      expense_date = coalesce(p_expense_date, expense_date),
      note = nullif(trim(coalesce(p_note, '')), ''),
      category = nullif(trim(coalesce(p_category, '')), ''),
      split_mode = coalesce(p_split_mode, 'equal'),
      updated_at = now()
  where id = e.id
  returning * into e;

  delete from public.expense_shares where expense_id = e.id;

  insert into public.expense_shares (expense_id, user_id, share_cents, weight)
  select e.id, (value ->> 'user_id')::uuid, (value ->> 'share_cents')::bigint,
         (value ->> 'weight')::numeric
  from jsonb_array_elements(p_shares);

  return e;
end;
$$;
