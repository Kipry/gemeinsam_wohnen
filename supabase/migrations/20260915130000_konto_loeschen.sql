-- Konto löschen und WG verlassen
--
-- Wer auszieht oder sein Konto löscht, darf den anderen nicht die Kasse
-- durcheinanderbringen: Ausgaben, Anteile und Rückzahlungen bleiben stehen,
-- das Profil bleibt als anonymes „Ehemaliges Mitglied". Alles Persönliche
-- (Abwesenheiten, Zusagen, Chat-Nachrichten, Putz-Plätze) verschwindet.

-- Profile überdauern das Auth-Konto als anonymisierter Eintrag
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles add column if not exists deleted_at timestamptz;

-- Austreten nur noch über leave_household — ein direktes DELETE ließe
-- verwaiste Rotationsplätze und Termine zurück.
drop policy if exists "selbst austreten oder als Owner entfernen" on public.household_members;

-- Entfernt eine Person aus einer WG und räumt hinter ihr auf.
-- Nur intern (Trigger, leave_household) — nicht für Clients freigegeben.
create or replace function public.remove_member(p_household_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected uuid[];
  v_task_id uuid;
  rec public.recurring_expenses;
  leaver_share bigint;
  remaining_count int;
  weight_total numeric;
begin
  if not exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = p_user_id
  ) then
    return;
  end if;

  -- Letztes Mitglied: die WG geht mit
  if not exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id <> p_user_id
  ) then
    -- Abwesenheiten zuerst, sonst plant ihr Lösch-Trigger mitten im Kaskadieren um
    delete from public.absences where household_id = p_household_id;
    delete from public.households where id = p_household_id;
    return;
  end if;

  -- WG nicht ohne Owner zurücklassen: die am längsten dabei ist, übernimmt
  if exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = p_user_id and role = 'owner'
  ) and not exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id <> p_user_id and role = 'owner'
  ) then
    update public.household_members
    set role = 'owner'
    where household_id = p_household_id
      and user_id = (
        select m.user_id from public.household_members m
        where m.household_id = p_household_id and m.user_id <> p_user_id
        order by m.joined_at
        limit 1
      );
  end if;

  delete from public.absences
  where household_id = p_household_id and user_id = p_user_id;

  delete from public.calendar_event_attendees a
  using public.calendar_events e
  where a.event_id = e.id and e.household_id = p_household_id and a.user_id = p_user_id;

  delete from public.team_members tm
  using public.teams t
  where tm.team_id = t.id and t.household_id = p_household_id and tm.user_id = p_user_id;

  update public.shopping_trips
  set finished_at = now()
  where household_id = p_household_id and shopper = p_user_id and finished_at is null;

  -- Feste Kosten, die die Person selbst zahlt, ergeben ohne sie keinen Sinn
  delete from public.recurring_expenses
  where household_id = p_household_id and paid_by = p_user_id;

  -- Geteilte feste Kosten: Anteil neu verteilen und pausieren, damit jemand
  -- bewusst prüft, bevor wieder gebucht wird
  for rec in
    select r.* from public.recurring_expenses r
    where r.household_id = p_household_id
      and exists (
        select 1 from public.recurring_expense_shares s
        where s.recurring_id = r.id and s.user_id = p_user_id
      )
  loop
    select s.share_cents into leaver_share
    from public.recurring_expense_shares s
    where s.recurring_id = rec.id and s.user_id = p_user_id;

    delete from public.recurring_expense_shares s
    where s.recurring_id = rec.id and s.user_id = p_user_id;

    select count(*), coalesce(sum(s.weight), 0) into remaining_count, weight_total
    from public.recurring_expense_shares s
    where s.recurring_id = rec.id;

    if remaining_count = 0 then
      delete from public.recurring_expenses where id = rec.id;
      continue;
    end if;

    if rec.split_mode = 'amounts' then
      -- Feste Beträge: niemand anderem ungefragt mehr aufbrummen — die zahlende
      -- Person trägt die Lücke, bis die Aufteilung neu geregelt ist
      insert into public.recurring_expense_shares (recurring_id, user_id, share_cents)
      values (rec.id, rec.paid_by, leaver_share)
      on conflict (recurring_id, user_id)
      do update set share_cents = public.recurring_expense_shares.share_cents + excluded.share_cents;
    else
      -- Gleichmäßig bzw. nach Gewicht unter den Verbliebenen (größter Rest)
      with exact as (
        select s.user_id,
               case
                 when rec.split_mode = 'weights' and weight_total > 0
                   then rec.amount_cents * coalesce(s.weight, 0) / weight_total
                 else rec.amount_cents::numeric / remaining_count
               end as value
        from public.recurring_expense_shares s
        where s.recurring_id = rec.id
      ),
      floored as (
        select user_id, floor(value)::bigint as cents, value - floor(value) as frac
        from exact
      ),
      ranked as (
        select user_id, cents, row_number() over (order by frac desc, user_id) as rn
        from floored
      )
      update public.recurring_expense_shares s
      set share_cents = ranked.cents
        + case when ranked.rn <= rec.amount_cents - (select sum(cents) from floored) then 1 else 0 end
      from ranked
      where s.recurring_id = rec.id and s.user_id = ranked.user_id;
    end if;

    update public.recurring_expenses set active = false where id = rec.id;
  end loop;

  -- Putzplan: Plätze räumen, offene Termine neu verteilen
  select coalesce(array_agg(t.id), '{}') into affected
  from public.tasks t
  where t.household_id = p_household_id
    and (
      t.fixed_assignee = p_user_id
      or exists (
        select 1 from public.task_rotation r
        where r.task_id = t.id and r.user_id = p_user_id
      )
    );

  update public.tasks
  set assignment_mode = 'anyone', fixed_assignee = null
  where household_id = p_household_id and fixed_assignee = p_user_id;

  delete from public.task_rotation r
  using public.tasks t
  where r.task_id = t.id and t.household_id = p_household_id and r.user_id = p_user_id;

  foreach v_task_id in array affected loop
    perform public.replan_task_from(v_task_id, current_date);
  end loop;

  -- Was dann noch an ihr hängt (z.B. überfällig), darf wer mag übernehmen
  update public.task_occurrences
  set assigned_to = null
  where household_id = p_household_id and assigned_to = p_user_id and status = 'open';

  -- Übernommene Bitten wieder freigeben
  update public.chat_messages
  set claimed_by = null
  where household_id = p_household_id and claimed_by = p_user_id and done_at is null;

  delete from public.chat_receipts cr
  using public.chat_messages m
  where cr.message_id = m.id and m.household_id = p_household_id and cr.user_id = p_user_id;

  delete from public.household_members
  where household_id = p_household_id and user_id = p_user_id;
end;
$$;

revoke execute on function public.remove_member(uuid, uuid) from public, anon, authenticated;

create or replace function public.leave_household(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'Keine Berechtigung';
  end if;

  if not exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id <> auth.uid()
  ) then
    raise exception 'Du bist das letzte Mitglied dieser WG';
  end if;

  perform public.remove_member(p_household_id, auth.uid());
end;
$$;

revoke execute on function public.leave_household(uuid) from public, anon;
grant execute on function public.leave_household(uuid) to authenticated;

-- Läuft, wenn ein Auth-Konto gelöscht wird — egal ob aus der App oder dem Dashboard
create or replace function public.handle_deleted_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership record;
begin
  for membership in
    select household_id from public.household_members where user_id = old.id
  loop
    perform public.remove_member(membership.household_id, old.id);
  end loop;

  delete from public.chat_messages where user_id = old.id;

  update public.profiles
  set full_name = 'Ehemaliges Mitglied', avatar_url = null, deleted_at = now()
  where id = old.id;

  return old;
end;
$$;

revoke execute on function public.handle_deleted_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.handle_deleted_user();

-- Salden auch für Ehemalige: sonst gehen offene Beträge still verloren und
-- die Summe der Salden in der WG ist nicht mehr null.
create or replace view public.expense_balance_view
with (security_invoker = on) as
with people as (
  select household_id, user_id from public.household_members
  union
  select household_id, paid_by from public.expenses where deleted_at is null
  union
  select e.household_id, s.user_id
  from public.expense_shares s
  join public.expenses e on e.id = s.expense_id
  where e.deleted_at is null
  union
  select household_id, from_user from public.settlements
  union
  select household_id, to_user from public.settlements
)
select
  p.household_id,
  p.user_id,
  coalesce(paid.cents, 0)::bigint as paid_cents,
  coalesce(owed.cents, 0)::bigint as owed_cents,
  (coalesce(paid.cents, 0) - coalesce(owed.cents, 0)
    + coalesce(transfers.sent, 0) - coalesce(transfers.received, 0))::bigint as net_cents
from people p
left join (
  select household_id, paid_by as user_id, sum(amount_cents) as cents
  from public.expenses
  where deleted_at is null
  group by household_id, paid_by
) paid on paid.household_id = p.household_id and paid.user_id = p.user_id
left join (
  select e.household_id, s.user_id, sum(s.share_cents) as cents
  from public.expense_shares s
  join public.expenses e on e.id = s.expense_id
  where e.deleted_at is null
  group by e.household_id, s.user_id
) owed on owed.household_id = p.household_id and owed.user_id = p.user_id
left join (
  select household_id, user_id, sum(sent) as sent, sum(received) as received
  from (
    select household_id, from_user as user_id, amount_cents as sent, 0::bigint as received
    from public.settlements
    union all
    select household_id, to_user as user_id, 0::bigint as sent, amount_cents as received
    from public.settlements
  ) t
  group by household_id, user_id
) transfers on transfers.household_id = p.household_id and transfers.user_id = p.user_id;

-- Eine kaputte Vorlage darf nicht alle anderen festen Kosten blockieren
create or replace function public.book_due_recurring(p_household_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.recurring_expenses;
  shares jsonb;
  due date;
  cursor_date date;
  created int := 0;
  guard int;
  failed boolean;
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'Keine Berechtigung';
  end if;

  for r in
    select * from public.recurring_expenses
    where household_id = p_household_id and active
  loop
    select jsonb_agg(jsonb_build_object(
             'user_id', user_id, 'share_cents', share_cents, 'weight', weight))
    into shares
    from public.recurring_expense_shares
    where recurring_id = r.id;

    if shares is null then
      continue;
    end if;

    cursor_date := coalesce(r.last_booked_on, (r.created_at at time zone 'UTC')::date - 1);
    guard := 0;
    failed := false;

    loop
      guard := guard + 1;
      exit when guard > 24;

      due := public.next_due_day(cursor_date, r.day_of_month);
      exit when due is null or due > current_date;

      begin
        perform public.create_expense(
          r.household_id,
          r.title,
          r.amount_cents,
          r.paid_by,
          shares,
          r.split_mode,
          r.category,
          due,
          'Feste Kosten'
        );
      exception when others then
        raise warning 'Feste Kosten % übersprungen: %', r.id, sqlerrm;
        failed := true;
      end;

      exit when failed;

      update public.recurring_expenses set last_booked_on = due where id = r.id;
      created := created + 1;
      cursor_date := due;
    end loop;
  end loop;

  return created;
end;
$$;
