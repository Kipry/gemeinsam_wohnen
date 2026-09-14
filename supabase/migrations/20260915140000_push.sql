-- Push-Benachrichtigungen
--
-- Die Datenbank verschickt selbst: Trigger rufen send_push auf, das die
-- Expo-Push-API über pg_net anspricht. pg_net sendet erst nach dem Commit —
-- eine zurückgerollte Aktion löst also keine Mitteilung aus.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ---------------------------------------------------------------------------
-- Geräte und Einstellungen
-- ---------------------------------------------------------------------------

create table if not exists public.push_tokens (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text,
  updated_at timestamptz not null default now()
);

create index if not exists push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

create policy "eigene Push-Tokens sehen" on public.push_tokens
  for select using (user_id = auth.uid());

create policy "eigene Push-Tokens entfernen" on public.push_tokens
  for delete using (user_id = auth.uid());

create table if not exists public.notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  chores boolean not null default true,
  chat boolean not null default true,
  shopping boolean not null default true,
  expenses boolean not null default true,
  calendar boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;

create policy "eigene Mitteilungs-Einstellungen" on public.notification_prefs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Ein Gerät gehört immer dem zuletzt angemeldeten Konto
create or replace function public.register_push_token(p_token text, p_platform text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;

  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[.+\]$' then
    raise exception 'Ungültiger Push-Token';
  end if;

  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), p_platform, now())
  on conflict (token) do update
  set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$$;

revoke execute on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Versand
-- ---------------------------------------------------------------------------

create or replace function public.format_euro(p_cents bigint)
returns text
language sql
stable
set search_path = ''
as $$
  select translate(to_char(p_cents / 100.0, 'FM999G999G990D00'), '.,', ',.') || ' €';
$$;

create or replace function public.household_member_ids(p_household_id uuid, p_except uuid default null)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(user_id), '{}')
  from public.household_members
  where household_id = p_household_id and user_id is distinct from p_except;
$$;

create or replace function public.display_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select full_name from public.profiles where id = p_user_id), 'Jemand');
$$;

create or replace function public.send_push(
  p_user_ids uuid[],
  p_household_id uuid,
  p_category text,
  p_title text,
  p_body text,
  p_data jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch record;
begin
  if p_user_ids is null or cardinality(p_user_ids) = 0 then
    return;
  end if;

  for batch in
    select jsonb_agg(message) as messages
    from (
      select
        jsonb_strip_nulls(jsonb_build_object(
          'to', t.token,
          'title', p_title,
          -- Wer in mehreren WGs ist, sieht, aus welcher die Nachricht kommt
          'subtitle', case
            when (select count(*) from public.household_members m where m.user_id = t.user_id) > 1
              then h.name
          end,
          'body', case when length(p_body) > 178 then left(p_body, 177) || '…' else p_body end,
          'sound', 'default',
          'data', coalesce(p_data, '{}'::jsonb) || jsonb_build_object('householdId', p_household_id)
        )) as message,
        (row_number() over () - 1) / 100 as chunk
      from public.push_tokens t
      join public.household_members hm
        on hm.user_id = t.user_id and hm.household_id = p_household_id
      join public.households h on h.id = p_household_id
      left join public.notification_prefs np on np.user_id = t.user_id
      where t.user_id = any (p_user_ids)
        and coalesce(
          case p_category
            when 'chores' then np.chores
            when 'chat' then np.chat
            when 'shopping' then np.shopping
            when 'expenses' then np.expenses
            when 'calendar' then np.calendar
          end,
          true
        )
    ) prepared
    group by chunk
  loop
    begin
      perform net.http_post(
        url := 'https://exp.host/--/api/v2/push/send',
        body := batch.messages,
        headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
        timeout_milliseconds := 5000
      );
    exception when others then
      -- Eine Mitteilung darf nie die eigentliche Aktion scheitern lassen
      raise warning 'Push nicht verschickt: %', sqlerrm;
    end;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Anlässe
-- ---------------------------------------------------------------------------

create or replace function public.push_on_chat_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  author text := public.display_name(new.user_id);
begin
  if new.kind not in ('message', 'announcement', 'request') then
    return new;
  end if;

  perform public.send_push(
    public.household_member_ids(new.household_id, new.user_id),
    new.household_id,
    'chat',
    case new.kind
      when 'announcement' then '📢 ' || author
      when 'request' then '🙋 Bitte von ' || author
      else author
    end,
    new.content,
    jsonb_build_object('url', '/chat')
  );
  return new;
end;
$$;

create trigger push_chat_message
  after insert on public.chat_messages
  for each row execute function public.push_on_chat_message();

create or replace function public.push_on_request_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
begin
  if new.kind <> 'request' then
    return new;
  end if;

  if old.done_at is null and new.done_at is not null then
    actor := coalesce(auth.uid(), new.claimed_by);
    if actor is not null and actor <> new.user_id then
      perform public.send_push(
        array[new.user_id], new.household_id, 'chat',
        '✅ ' || public.display_name(actor) || ' hat''s erledigt',
        new.content,
        jsonb_build_object('url', '/chat')
      );
    end if;
  elsif old.claimed_by is null and new.claimed_by is not null and new.claimed_by <> new.user_id then
    perform public.send_push(
      array[new.user_id], new.household_id, 'chat',
      '👍 ' || public.display_name(new.claimed_by) || ' kümmert sich drum',
      new.content,
      jsonb_build_object('url', '/chat')
    );
  end if;
  return new;
end;
$$;

create trigger push_request_update
  after update of claimed_by, done_at on public.chat_messages
  for each row execute function public.push_on_request_update();

create or replace function public.push_on_expense_share()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.expenses;
  actor text;
begin
  select * into e from public.expenses where id = new.expense_id;

  -- Nur beim Anlegen (selbe Transaktion), nicht beim Bearbeiten.
  -- Feste Kosten bucht die App im Hintergrund — dafür keine Mitteilung.
  if not found
     or e.deleted_at is not null
     or e.created_at <> now()
     or new.user_id = e.created_by
     or new.share_cents = 0
     or coalesce(e.note, '') = 'Feste Kosten' then
    return new;
  end if;

  actor := public.display_name(e.created_by);

  perform public.send_push(
    array[new.user_id],
    e.household_id,
    'expenses',
    '💸 ' || e.title || ' · ' || public.format_euro(e.amount_cents),
    case
      when new.user_id = e.paid_by
        then actor || ' hat eingetragen, dass du bezahlt hast. Dein Anteil: '
             || public.format_euro(new.share_cents)
      when e.paid_by = e.created_by
        then actor || ' hat bezahlt. Dein Anteil: ' || public.format_euro(new.share_cents)
      else public.display_name(e.paid_by) || ' hat bezahlt. Dein Anteil: '
           || public.format_euro(new.share_cents)
    end,
    jsonb_build_object('url', '/expense/' || e.id)
  );
  return new;
end;
$$;

create trigger push_expense_share
  after insert on public.expense_shares
  for each row execute function public.push_on_expense_share();

create or replace function public.push_on_settlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  creator text := public.display_name(new.created_by);
  amount text := public.format_euro(new.amount_cents);
begin
  if new.created_by = new.from_user then
    perform public.send_push(
      array[new.to_user], new.household_id, 'expenses',
      '💶 ' || creator || ' hat dir ' || amount || ' zurückgezahlt',
      'Ist in euren Salden schon verrechnet.',
      jsonb_build_object('url', '/expenses')
    );
  elsif new.created_by = new.to_user then
    perform public.send_push(
      array[new.from_user], new.household_id, 'expenses',
      '💶 ' || creator || ' hat deine Zahlung über ' || amount || ' bestätigt',
      'Ist in euren Salden schon verrechnet.',
      jsonb_build_object('url', '/expenses')
    );
  else
    perform public.send_push(
      array[new.from_user, new.to_user], new.household_id, 'expenses',
      '💶 Rückzahlung über ' || amount,
      creator || ' hat sie eingetragen.',
      jsonb_build_object('url', '/expenses')
    );
  end if;
  return new;
end;
$$;

create trigger push_settlement
  after insert on public.settlements
  for each row execute function public.push_on_settlement();

create or replace function public.push_on_shopping_trip()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  open_items int;
begin
  select count(*) into open_items
  from public.shopping_items
  where household_id = new.household_id and status = 'open' and deleted_at is null;

  perform public.send_push(
    public.household_member_ids(new.household_id, new.shopper),
    new.household_id,
    'shopping',
    '🛒 ' || public.display_name(new.shopper) || ' geht einkaufen'
      || coalesce(' (' || nullif(new.store, '') || ')', ''),
    case
      when open_items = 0 then 'Die Liste ist leer – brauchst du was?'
      when open_items = 1 then '1 Sache steht auf der Liste. Fehlt noch was?'
      else open_items || ' Sachen stehen auf der Liste. Fehlt noch was?'
    end,
    jsonb_build_object('url', '/shopping')
  );
  return new;
end;
$$;

create trigger push_shopping_trip
  after insert on public.shopping_trips
  for each row execute function public.push_on_shopping_trip();

create or replace function public.push_on_calendar_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.send_push(
    public.household_member_ids(new.household_id, new.created_by),
    new.household_id,
    'calendar',
    '📅 ' || new.title,
    case
      when new.starts_on = new.ends_on
        then to_char(new.starts_on, 'DD.MM.')
             || coalesce(', ' || to_char(new.start_time, 'HH24:MI') || ' Uhr', '')
      else to_char(new.starts_on, 'DD.MM.') || ' bis ' || to_char(new.ends_on, 'DD.MM.')
    end || ' · eingetragen von ' || public.display_name(new.created_by),
    jsonb_build_object('url', '/event/' || new.id)
  );
  return new;
end;
$$;

create trigger push_calendar_event
  after insert on public.calendar_events
  for each row execute function public.push_on_calendar_event();

create or replace function public.push_on_absence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.send_push(
    public.household_member_ids(new.household_id, new.user_id),
    new.household_id,
    'calendar',
    '🧳 ' || public.display_name(new.user_id) || ' ist weg',
    case
      when new.start_date = new.end_date then 'Am ' || to_char(new.start_date, 'DD.MM.')
      else 'Vom ' || to_char(new.start_date, 'DD.MM.') || ' bis ' || to_char(new.end_date, 'DD.MM.')
    end,
    jsonb_build_object('url', '/calendar')
  );
  return new;
end;
$$;

create trigger push_absence
  after insert on public.absences
  for each row execute function public.push_on_absence();

create or replace function public.push_on_member_joined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.send_push(
    public.household_member_ids(new.household_id, new.user_id),
    new.household_id,
    'chat',
    '🎉 ' || public.display_name(new.user_id) || ' ist jetzt dabei',
    'Willkommen in ' || (select name from public.households where id = new.household_id) || '!',
    jsonb_build_object('url', '/chat')
  );
  return new;
end;
$$;

create trigger push_member_joined
  after insert on public.household_members
  for each row execute function public.push_on_member_joined();

create or replace function public.push_on_task_done()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'done' or new.status <> 'done' or new.completed_by is null
     or new.assigned_to is null or new.assigned_to = new.completed_by then
    return new;
  end if;

  perform public.send_push(
    array[new.assigned_to],
    new.household_id,
    'chores',
    '🙌 ' || public.display_name(new.completed_by) || ' hat für dich übernommen',
    '„' || (select title from public.tasks where id = new.task_id) || '“ ist erledigt.',
    jsonb_build_object('url', '/tasks')
  );
  return new;
end;
$$;

create trigger push_task_done
  after update of status on public.task_occurrences
  for each row execute function public.push_on_task_done();

-- Am Vorabend: wer morgen dran ist, bekommt eine Erinnerung
create or replace function public.send_chore_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  reminder record;
  titles text[];
begin
  for reminder in
    select due.household_id, due.user_id, array_agg(distinct due.title) as titles
    from (
      select o.household_id, t.title, coalesce(o.assigned_to, tm.user_id) as user_id
      from public.task_occurrences o
      join public.tasks t on t.id = o.task_id
      left join public.team_members tm on tm.team_id = o.assigned_team_id
      where o.status = 'open'
        and o.due_date = (now() at time zone 'Europe/Berlin')::date + 1
    ) due
    where due.user_id is not null
    group by due.household_id, due.user_id
  loop
    titles := reminder.titles;
    perform public.send_push(
      array[reminder.user_id],
      reminder.household_id,
      'chores',
      '🧽 Morgen bist du dran',
      case
        when cardinality(titles) = 1 then titles[1]
        else array_to_string(titles[1:cardinality(titles) - 1], ', ')
             || ' und ' || titles[cardinality(titles)]
      end,
      jsonb_build_object('url', '/tasks')
    );
  end loop;
end;
$$;

-- 16:00 UTC = 18:00 Uhr Sommerzeit, 17:00 Uhr Winterzeit
select cron.schedule('putz-erinnerungen', '0 16 * * *', 'select public.send_chore_reminders()');

-- Interne Helfer: niemand darf darüber selbst Mitteilungen auslösen
revoke execute on function public.send_push(uuid[], uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.household_member_ids(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.display_name(uuid) from public, anon, authenticated;
revoke execute on function public.send_chore_reminders() from public, anon, authenticated;
revoke execute on function public.push_on_chat_message() from public, anon, authenticated;
revoke execute on function public.push_on_request_update() from public, anon, authenticated;
revoke execute on function public.push_on_expense_share() from public, anon, authenticated;
revoke execute on function public.push_on_settlement() from public, anon, authenticated;
revoke execute on function public.push_on_shopping_trip() from public, anon, authenticated;
revoke execute on function public.push_on_calendar_event() from public, anon, authenticated;
revoke execute on function public.push_on_absence() from public, anon, authenticated;
revoke execute on function public.push_on_member_joined() from public, anon, authenticated;
revoke execute on function public.push_on_task_done() from public, anon, authenticated;
