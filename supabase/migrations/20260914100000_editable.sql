-- Block A+B: Korrigierbarkeit und reichere Aufteilung
--
-- Bisher war jede Eingabe endgültig: Ausgaben ließen sich weder bearbeiten
-- noch löschen, ein Tippfehler vergiftete den Saldo dauerhaft. Aufgaben
-- konnten nicht geändert werden, Abhaken nicht rückgängig gemacht werden.
-- Außerdem wurde nur das Cent-Ergebnis einer Aufteilung gespeichert, nicht
-- die Regel dahinter — nach einer Betragskorrektur ließ sich nicht neu
-- aufteilen.

-- ───────────────────────────────────────────── Ausgaben
alter table public.expenses
  add column category text,
  add column split_mode text not null default 'equal'
    check (split_mode in ('equal', 'amounts', 'weights')),
  add column updated_at timestamptz,
  add column deleted_at timestamptz;

-- Gewicht der Person an dieser Ausgabe (z.B. 1, 1, 2 bei ungleichen Zimmern)
alter table public.expense_shares
  add column weight numeric check (weight is null or weight > 0);

create index on public.expenses (household_id, deleted_at);

-- Gelöschte Ausgaben dürfen nicht mehr in den Saldo einfließen.
create or replace view public.expense_balance_view with (security_invoker = on) as
select
  hm.household_id,
  hm.user_id,
  coalesce(paid.cents, 0)::bigint as paid_cents,
  coalesce(owed.cents, 0)::bigint as owed_cents,
  (
    coalesce(paid.cents, 0) - coalesce(owed.cents, 0)
    + coalesce(transfers.sent, 0) - coalesce(transfers.received, 0)
  )::bigint as net_cents
from public.household_members hm
left join (
  select household_id, paid_by as user_id, sum(amount_cents) as cents
  from public.expenses
  where deleted_at is null
  group by 1, 2
) paid on paid.household_id = hm.household_id and paid.user_id = hm.user_id
left join (
  select e.household_id, s.user_id, sum(s.share_cents) as cents
  from public.expense_shares s
  join public.expenses e on e.id = s.expense_id
  where e.deleted_at is null
  group by 1, 2
) owed on owed.household_id = hm.household_id and owed.user_id = hm.user_id
left join (
  select household_id, user_id, sum(sent) as sent, sum(received) as received
  from (
    select household_id, from_user as user_id, amount_cents as sent, 0::bigint as received
    from public.settlements
    union all
    select household_id, to_user as user_id, 0::bigint as sent, amount_cents as received
    from public.settlements
  ) t
  group by 1, 2
) transfers on transfers.household_id = hm.household_id and transfers.user_id = hm.user_id;

-- Alte Signatur ablegen, damit PostgREST keine zwei Überladungen sieht.
drop function public.create_expense(uuid, text, bigint, uuid, jsonb, date, text);

-- p_shares: [{"user_id": "...", "share_cents": 1234, "weight": 2}, ...]
-- Anteile mit 0 Cent bleiben erhalten ("war beteiligt, zahlt nichts") —
-- vorher gingen sie spurlos verloren.
create function public.create_expense(
  p_household_id uuid,
  p_title text,
  p_amount_cents bigint,
  p_paid_by uuid,
  p_shares jsonb,
  p_split_mode text default 'equal',
  p_category text default null,
  p_expense_date date default current_date,
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
  perform public.assert_expense_input(p_household_id, p_amount_cents, p_paid_by, p_shares);

  insert into public.expenses (
    household_id, title, amount_cents, paid_by, expense_date, note,
    category, split_mode, created_by
  )
  values (
    p_household_id, trim(p_title), p_amount_cents, p_paid_by,
    coalesce(p_expense_date, current_date), nullif(trim(coalesce(p_note, '')), ''),
    nullif(trim(coalesce(p_category, '')), ''), coalesce(p_split_mode, 'equal'), auth.uid()
  )
  returning * into e;

  insert into public.expense_shares (expense_id, user_id, share_cents, weight)
  select e.id, (value ->> 'user_id')::uuid, (value ->> 'share_cents')::bigint,
         (value ->> 'weight')::numeric
  from jsonb_array_elements(p_shares);

  return e;
end;
$$;

-- Gemeinsame Prüfung für Anlegen und Bearbeiten.
create function public.assert_expense_input(
  p_household_id uuid,
  p_amount_cents bigint,
  p_paid_by uuid,
  p_shares jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  share_total bigint;
  outsiders int;
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'Keine Berechtigung';
  end if;

  if p_amount_cents <= 0 then
    raise exception 'Betrag muss größer als 0 sein';
  end if;

  if jsonb_array_length(coalesce(p_shares, '[]'::jsonb)) = 0 then
    raise exception 'Mindestens eine beteiligte Person nötig';
  end if;

  select coalesce(sum((value ->> 'share_cents')::bigint), 0)
  into share_total
  from jsonb_array_elements(p_shares);

  if share_total <> p_amount_cents then
    raise exception 'Summe der Anteile (%) entspricht nicht dem Betrag (%)', share_total, p_amount_cents;
  end if;

  select count(*) into outsiders
  from (
    select (value ->> 'user_id')::uuid as user_id from jsonb_array_elements(p_shares)
    union
    select p_paid_by
  ) s
  where not exists (
    select 1 from public.household_members m
    where m.household_id = p_household_id and m.user_id = s.user_id
  );

  if outsiders > 0 then
    raise exception 'Beteiligte müssen Mitglieder der WG sein';
  end if;
end;
$$;

create function public.update_expense(
  p_expense_id uuid,
  p_title text,
  p_amount_cents bigint,
  p_paid_by uuid,
  p_shares jsonb,
  p_split_mode text default 'equal',
  p_category text default null,
  p_expense_date date default current_date,
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

-- Löschen ist weich: der Eintrag verschwindet aus Liste und Saldo, bleibt
-- aber für ein mögliches "Rückgängig" erhalten.
create function public.delete_expense(p_expense_id uuid, p_undo boolean default false)
returns public.expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.expenses;
begin
  select * into e from public.expenses where id = p_expense_id;
  if not found then
    raise exception 'Ausgabe nicht gefunden';
  end if;

  if not public.is_household_member(e.household_id) then
    raise exception 'Keine Berechtigung';
  end if;

  update public.expenses
  set deleted_at = case when p_undo then null else now() end
  where id = e.id
  returning * into e;

  return e;
end;
$$;

revoke all on function public.assert_expense_input(uuid, bigint, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.create_expense(uuid, text, bigint, uuid, jsonb, text, text, date, text) from public, anon;
revoke all on function public.update_expense(uuid, text, bigint, uuid, jsonb, text, text, date, text) from public, anon;
revoke all on function public.delete_expense(uuid, boolean) from public, anon;
grant execute on function public.create_expense(uuid, text, bigint, uuid, jsonb, text, text, date, text) to authenticated;
grant execute on function public.update_expense(uuid, text, bigint, uuid, jsonb, text, text, date, text) to authenticated;
grant execute on function public.delete_expense(uuid, boolean) to authenticated;

-- ───────────────────────────────────────────── Aufgaben
-- Folgetermine kennen ihren Ursprung, damit "Rückgängig" sie wieder entfernen kann.
alter table public.task_occurrences
  add column generated_from uuid references public.task_occurrences (id) on delete set null;

create or replace function public.complete_occurrence(p_occurrence_id uuid)
returns public.task_occurrences
language plpgsql
security definer
set search_path = ''
as $$
declare
  occ public.task_occurrences;
  t public.tasks;
  nxt public.task_occurrences;
begin
  select * into occ from public.task_occurrences where id = p_occurrence_id;
  if not found then
    raise exception 'Termin nicht gefunden';
  end if;

  if not public.is_household_member(occ.household_id) then
    raise exception 'Keine Berechtigung';
  end if;

  if occ.status = 'done' then
    return occ;
  end if;

  select * into t from public.tasks where id = occ.task_id;

  update public.task_occurrences
  set status = 'done', completed_by = auth.uid(), completed_at = now()
  where id = occ.id
  returning * into occ;

  nxt := public.generate_occurrence(
    t.id,
    greatest(occ.due_date, current_date) + t.interval_days,
    occ.rotation_position
  );

  if nxt.id is not null then
    update public.task_occurrences set generated_from = occ.id where id = nxt.id;
  end if;

  return occ;
end;
$$;

-- Abhaken rückgängig machen: Status zurück und den erzeugten Folgetermin
-- wieder entfernen, damit Rotation und Statistik stimmen.
create function public.uncomplete_occurrence(p_occurrence_id uuid)
returns public.task_occurrences
language plpgsql
security definer
set search_path = ''
as $$
declare
  occ public.task_occurrences;
begin
  select * into occ from public.task_occurrences where id = p_occurrence_id;
  if not found then
    raise exception 'Termin nicht gefunden';
  end if;

  if not public.is_household_member(occ.household_id) then
    raise exception 'Keine Berechtigung';
  end if;

  delete from public.task_occurrences
  where generated_from = occ.id and status = 'open';

  update public.task_occurrences
  set status = 'open', completed_by = null, completed_at = null
  where id = occ.id
  returning * into occ;

  return occ;
end;
$$;

-- Aufgabe ändern. Ändert sich die Zuteilung, werden offene Termine neu
-- erzeugt — sonst bliebe eine veraltete Zuweisung stehen.
create function public.update_task(
  p_task_id uuid,
  p_title text,
  p_points int,
  p_interval_days int,
  p_assignment_mode public.assignment_mode,
  p_rotation jsonb default '[]'::jsonb,
  p_fixed_assignee uuid default null,
  p_skip_absent boolean default true,
  p_active boolean default true,
  p_description text default null
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
  keep_due date;
begin
  select * into t from public.tasks where id = p_task_id;
  if not found then
    raise exception 'Aufgabe nicht gefunden';
  end if;

  if not public.is_household_member(t.household_id) then
    raise exception 'Keine Berechtigung';
  end if;

  if length(trim(coalesce(p_title, ''))) = 0 then
    raise exception 'Titel darf nicht leer sein';
  end if;

  select min(due_date) into keep_due
  from public.task_occurrences
  where task_id = t.id and status = 'open';

  update public.tasks
  set title = trim(p_title),
      description = nullif(trim(coalesce(p_description, '')), ''),
      points = greatest(coalesce(p_points, 1), 1),
      interval_days = greatest(coalesce(p_interval_days, 7), 1),
      assignment_mode = p_assignment_mode,
      fixed_assignee = p_fixed_assignee,
      skip_absent = coalesce(p_skip_absent, true),
      active = coalesce(p_active, true)
  where id = t.id
  returning * into t;

  delete from public.task_rotation where task_id = t.id;

  if p_assignment_mode in ('rotation_member', 'rotation_team') then
    insert into public.task_rotation (task_id, position, user_id, team_id)
    select t.id, (ord - 1)::int, (elem ->> 'user_id')::uuid, (elem ->> 'team_id')::uuid
    from jsonb_array_elements(coalesce(p_rotation, '[]'::jsonb)) with ordinality as e(elem, ord);
  end if;

  delete from public.task_occurrences where task_id = t.id and status = 'open';

  if t.active then
    perform public.generate_occurrence(t.id, coalesce(keep_due, current_date), null);
  end if;

  return t;
end;
$$;

revoke all on function public.uncomplete_occurrence(uuid) from public, anon;
revoke all on function public.update_task(uuid, text, int, int, public.assignment_mode, jsonb, uuid, boolean, boolean, text) from public, anon;
grant execute on function public.uncomplete_occurrence(uuid) to authenticated;
grant execute on function public.update_task(uuid, text, int, int, public.assignment_mode, jsonb, uuid, boolean, boolean, text) to authenticated;

-- ───────────────────────────────────────────── Einkaufsliste
alter table public.shopping_items
  add column category text,
  add column deleted_at timestamptz;

create index on public.shopping_items (household_id, deleted_at);

-- ───────────────────────────────────────────── Realtime
-- Salden und Termine sollen sich ohne Tabwechsel aktualisieren.
alter publication supabase_realtime add table public.expenses;
alter publication supabase_realtime add table public.settlements;
alter publication supabase_realtime add table public.task_occurrences;
alter publication supabase_realtime add table public.absences;
