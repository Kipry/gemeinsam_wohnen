-- Chat: Umfragen, Aushänge abhängen, eigene Nachrichten löschen
--
-- Umfragen sind Chatnachrichten der Art 'poll'. Die Antworten hängen an der
-- Nachricht selbst, sie ändern sich nach dem Absenden nicht mehr. Die Stimmen
-- liegen in einer eigenen Tabelle, eine Zeile je Person: so kann niemand fremde
-- Stimmen anfassen, und Echtzeit kommt ohne DELETE-Ereignisse aus (die lassen
-- sich nicht nach WG filtern).
--
-- Aushänge klebten bisher stur 14 Tage oben, auch wenn längst alle
-- „Verstanden" getippt hatten, und ließen sich weder abhängen noch löschen.
-- Jetzt verschwindet ein Aushang für jeden, der ihn bestätigt hat (regelt die
-- App), und wer ihn gemacht hat, kann ihn abhängen. Die 14 Tage bleiben als
-- Obergrenze. Löschen durften Autoren schon immer (Policy aus daily.sql), es
-- fehlte nur der Weg in der App.

-- ───────────────────────────────────────────── Umfragen
create function public.poll_options_valid(p_options text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select cardinality(p_options) between 2 and 10
    and not exists (
      select 1 from unnest(p_options) as o(label)
      where o.label is null or length(trim(o.label)) = 0 or length(o.label) > 100
    )
    and (select count(distinct lower(trim(o.label))) from unnest(p_options) as o(label))
        = cardinality(p_options);
$$;

alter table public.chat_messages drop constraint chat_messages_kind_check;

alter table public.chat_messages
  add column poll_options text[],
  add column poll_multiple boolean not null default false,
  add column poll_closed_at timestamptz,
  add constraint chat_messages_kind_check
    check (kind in ('message', 'event', 'announcement', 'request', 'poll')),
  add constraint chat_messages_poll_check
    check ((kind = 'poll') = (poll_options is not null)
           and (poll_options is null or public.poll_options_valid(poll_options)));

create table public.chat_poll_votes (
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Steht immer auf der WG der Umfrage; nötig für RLS und den Echtzeit-Filter
  household_id uuid not null references public.households (id) on delete cascade,
  -- Positionen in poll_options; leer heißt: Stimme zurückgenommen
  choices smallint[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index on public.chat_poll_votes (household_id);

alter table public.chat_poll_votes enable row level security;

create policy "Stimmen der eigenen WG lesen"
  on public.chat_poll_votes for select to authenticated
  using (public.is_household_member(household_id));

-- Geschrieben wird nur über vote_poll()
revoke insert, update, delete, truncate on public.chat_poll_votes from anon, authenticated;

create function public.vote_poll(p_message_id uuid, p_choices smallint[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.chat_messages;
  clean smallint[];
begin
  select * into m
  from public.chat_messages
  where id = p_message_id and kind = 'poll';

  if not found or not public.is_household_member(m.household_id) then
    raise exception 'Umfrage nicht gefunden';
  end if;
  if m.poll_closed_at is not null then
    raise exception 'Die Umfrage ist schon beendet';
  end if;

  select coalesce(array_agg(distinct t.choice order by t.choice), '{}')
  into clean
  from unnest(coalesce(p_choices, '{}')) as t(choice);

  if exists (select 1 from unnest(clean) as t(choice)
             where t.choice < 0 or t.choice >= cardinality(m.poll_options)) then
    raise exception 'Diese Antwort gibt es nicht';
  end if;
  if not m.poll_multiple and cardinality(clean) > 1 then
    raise exception 'Hier geht nur eine Antwort';
  end if;

  insert into public.chat_poll_votes (message_id, user_id, household_id, choices, updated_at)
  values (m.id, auth.uid(), m.household_id, clean, now())
  on conflict (message_id, user_id)
  do update set choices = excluded.choices, updated_at = excluded.updated_at;
end;
$$;

create function public.close_poll(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chat_messages
  set poll_closed_at = now()
  where id = p_message_id
    and kind = 'poll'
    and user_id = auth.uid()
    and poll_closed_at is null;

  if not found and not exists (
    select 1 from public.chat_messages
    where id = p_message_id and user_id = auth.uid() and poll_closed_at is not null
  ) then
    raise exception 'Nur wer die Umfrage gestartet hat, kann sie beenden';
  end if;
end;
$$;

-- Wer auszieht, stimmt in offenen Umfragen nicht mehr mit
create function public.drop_open_poll_votes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.chat_poll_votes v
  using public.chat_messages m
  where v.message_id = m.id
    and v.household_id = old.household_id
    and v.user_id = old.user_id
    and m.poll_closed_at is null;
  return old;
end;
$$;

create trigger drop_open_poll_votes
  after delete on public.household_members
  for each row execute function public.drop_open_poll_votes();

-- ───────────────────────────────────────────── Aushänge
create function public.unpin_announcement(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chat_messages
  set pinned_until = null
  where id = p_message_id and kind = 'announcement' and user_id = auth.uid();

  if not found then
    raise exception 'Nur wer den Aushang gemacht hat, kann ihn abhängen';
  end if;
end;
$$;

-- ───────────────────────────────────────────── Wer darf was ändern
-- Bisher durfte jedes Mitglied jede Spalte jeder Nachricht ändern, auch den
-- Text von anderen. Direkt aus der App ändern sich nur „Mach ich" und
-- „Erledigt"; Abhängen und Beenden laufen über die Funktionen oben.
revoke update on public.chat_messages from anon, authenticated;
grant update (claimed_by, done_at) on public.chat_messages to authenticated;

revoke execute on function public.vote_poll(uuid, smallint[]) from public, anon;
revoke execute on function public.close_poll(uuid) from public, anon;
revoke execute on function public.unpin_announcement(uuid) from public, anon;
grant execute on function public.vote_poll(uuid, smallint[]) to authenticated;
grant execute on function public.close_poll(uuid) to authenticated;
grant execute on function public.unpin_announcement(uuid) to authenticated;

-- ───────────────────────────────────────────── Mitteilungen
create or replace function public.push_on_chat_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  author text := public.display_name(new.user_id);
begin
  if new.kind not in ('message', 'announcement', 'request', 'poll') then
    return new;
  end if;

  perform public.send_push(
    public.household_member_ids(new.household_id, new.user_id),
    new.household_id,
    'chat',
    case new.kind
      when 'announcement' then '📢 ' || author
      when 'request' then '🙋 Bitte von ' || author
      when 'poll' then '📊 Umfrage von ' || author
      else author
    end,
    new.content,
    jsonb_build_object('url', '/chat')
  );
  return new;
end;
$$;

-- Einmal Bescheid, sobald alle anderen abgestimmt haben
create function public.push_on_poll_vote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.chat_messages;
begin
  -- Nur wenn gerade eine Stimme dazukommt, nicht beim Umentscheiden
  if cardinality(new.choices) = 0
     or (tg_op = 'UPDATE' and cardinality(old.choices) > 0) then
    return new;
  end if;

  select * into m from public.chat_messages where id = new.message_id;
  if not found or m.poll_closed_at is not null or new.user_id = m.user_id then
    return new;
  end if;

  if exists (
    select 1 from public.household_members hm
    where hm.household_id = m.household_id
      and hm.user_id <> m.user_id
      and not exists (
        select 1 from public.chat_poll_votes v
        where v.message_id = m.id and v.user_id = hm.user_id and cardinality(v.choices) > 0
      )
  ) then
    return new;
  end if;

  perform public.send_push(
    array[m.user_id], m.household_id, 'chat',
    '📊 Alle haben abgestimmt',
    m.content,
    jsonb_build_object('url', '/chat')
  );
  return new;
end;
$$;

create trigger push_poll_vote
  after insert or update of choices on public.chat_poll_votes
  for each row execute function public.push_on_poll_vote();

create function public.push_on_announcement_read()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.chat_messages;
begin
  select * into m from public.chat_messages where id = new.message_id;
  if not found or m.kind <> 'announcement' or new.user_id = m.user_id then
    return new;
  end if;

  if exists (
    select 1 from public.household_members hm
    where hm.household_id = m.household_id
      and hm.user_id <> m.user_id
      and not exists (
        select 1 from public.chat_receipts r
        where r.message_id = m.id and r.user_id = hm.user_id
      )
  ) then
    return new;
  end if;

  perform public.send_push(
    array[m.user_id], m.household_id, 'chat',
    '📢 Alle haben deinen Aushang gesehen',
    m.content,
    jsonb_build_object('url', '/chat')
  );
  return new;
end;
$$;

create trigger push_announcement_read
  after insert on public.chat_receipts
  for each row execute function public.push_on_announcement_read();

revoke all on function public.drop_open_poll_votes() from public, anon, authenticated;
revoke all on function public.push_on_poll_vote() from public, anon, authenticated;
revoke all on function public.push_on_announcement_read() from public, anon, authenticated;

-- Stimmen und „gesehen" sollen live nachrücken
alter publication supabase_realtime add table public.chat_poll_votes, public.chat_receipts;
