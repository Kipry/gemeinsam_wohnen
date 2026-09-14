-- Block D, Teil 3: Chat wird Pinnwand
--
-- Ein zweiter Geplänkel-Chat neben WhatsApp wäre totes Holz. Wertvoll wird
-- der Bereich nur durch das, was WhatsApp nicht kann: er weiß, was in der
-- App passiert. Erledigte Aufgaben, neue Ausgaben und Abwesenheiten
-- erscheinen als Karten im selben Verlauf und sind kommentierbar.
--
-- Dazu zwei Nachrichtenarten mit Folgen: Aushang (klebt oben, bis alle
-- "Verstanden" getippt haben) und Bitte (hat einen Übernehmen-Knopf).

alter table public.chat_messages
  add column kind text not null default 'message'
    check (kind in ('message', 'event', 'announcement', 'request')),
  add column ref_table text,
  add column ref_id uuid,
  add column reply_to uuid references public.chat_messages (id) on delete set null,
  add column pinned_until date,
  add column claimed_by uuid references public.profiles (id),
  add column done_at timestamptz,
  add column deleted_at timestamptz;

create index on public.chat_messages (household_id, kind);

-- Lesebestätigungen für Aushänge
create table public.chat_receipts (
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.chat_receipts enable row level security;

create policy "Bestätigungen der eigenen WG lesen"
  on public.chat_receipts for select to authenticated
  using (exists (
    select 1 from public.chat_messages m
    where m.id = message_id and public.is_household_member(m.household_id)
  ));

create policy "eigene Bestätigung setzen"
  on public.chat_receipts for insert to authenticated
  with check (user_id = auth.uid() and exists (
    select 1 from public.chat_messages m
    where m.id = message_id and public.is_household_member(m.household_id)
  ));

-- Ohne UPDATE-Policy ließen sich Aushänge nicht entpinnen und Bitten nicht
-- übernehmen — das fehlte bisher komplett.
create policy "Nachrichten der eigenen WG bearbeiten"
  on public.chat_messages for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- ───────────────────────────────────────────── Ereigniskarten
create function public.post_chat_event(
  p_household_id uuid,
  p_user_id uuid,
  p_content text,
  p_ref_table text,
  p_ref_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    return;
  end if;

  insert into public.chat_messages (household_id, user_id, content, kind, ref_table, ref_id)
  values (p_household_id, p_user_id, p_content, 'event', p_ref_table, p_ref_id);
end;
$$;

create function public.on_task_done()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_title text;
begin
  if new.status = 'done' and coalesce(old.status, '') <> 'done' then
    select title into task_title from public.tasks where id = new.task_id;
    perform public.post_chat_event(
      new.household_id, new.completed_by,
      format('hat „%s" erledigt', coalesce(task_title, 'eine Aufgabe')),
      'task_occurrences', new.id
    );
  end if;
  return new;
end;
$$;

create trigger on_task_occurrence_done
  after update on public.task_occurrences
  for each row execute function public.on_task_done();

create function public.on_expense_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.post_chat_event(
    new.household_id, new.created_by,
    format('hat „%s" über %s € eingetragen',
           new.title,
           to_char(new.amount_cents / 100.0, 'FM999G999D00')),
    'expenses', new.id
  );
  return new;
end;
$$;

create trigger on_expense_inserted
  after insert on public.expenses
  for each row execute function public.on_expense_created();

create function public.on_absence_created_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.post_chat_event(
    new.household_id, new.user_id,
    case
      when new.start_date = new.end_date
        then format('ist am %s nicht da', to_char(new.start_date, 'DD.MM.'))
      else format('ist vom %s bis %s weg',
                  to_char(new.start_date, 'DD.MM.'), to_char(new.end_date, 'DD.MM.'))
    end,
    'absences', new.id
  );
  return new;
end;
$$;

create trigger on_absence_inserted_event
  after insert on public.absences
  for each row execute function public.on_absence_created_event();

revoke all on function public.post_chat_event(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.on_task_done() from public, anon, authenticated;
revoke all on function public.on_expense_created() from public, anon, authenticated;
revoke all on function public.on_absence_created_event() from public, anon, authenticated;

alter table public.chat_messages replica identity full;
