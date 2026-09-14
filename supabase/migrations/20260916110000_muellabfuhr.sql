-- Müllabfuhr
--
-- Einmal eintragen, welche Tonne in welchem Rhythmus abgeholt wird. Die Termine
-- entstehen daraus rechnerisch (kein Vorausplanen nötig); einzelne Abholungen
-- lassen sich verschieben oder ausfallen lassen, etwa rund um Feiertage.

create table if not exists public.waste_bins (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  kind text not null check (kind in ('rest', 'papier', 'bio', 'gelb', 'sonstige')),
  label text not null check (length(trim(label)) between 1 and 40),
  -- Ein bekannter Abholtermin; alle interval_weeks Wochen davor und danach ebenso
  first_date date not null,
  interval_weeks smallint not null default 1 check (interval_weeks between 1 and 8),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists waste_bins_household_idx on public.waste_bins (household_id);

create table if not exists public.waste_bin_changes (
  bin_id uuid not null references public.waste_bins (id) on delete cascade,
  original_date date not null,
  -- null: diese Abholung fällt aus
  new_date date,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (bin_id, original_date),
  check (new_date is null or new_date <> original_date)
);

alter table public.waste_bins enable row level security;
alter table public.waste_bin_changes enable row level security;

create policy "Tonnen der eigenen WG" on public.waste_bins
  for all using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "Abfuhr-Änderungen der eigenen WG" on public.waste_bin_changes
  for all using (
    exists (select 1 from public.waste_bins b where b.id = bin_id and public.is_household_member(b.household_id))
  )
  with check (
    exists (select 1 from public.waste_bins b where b.id = bin_id and public.is_household_member(b.household_id))
  );

alter publication supabase_realtime add table public.waste_bins;
alter publication supabase_realtime add table public.waste_bin_changes;

-- Mitteilung „Morgen wird abgeholt" — eigene Kategorie, einzeln abschaltbar
alter table public.notification_prefs
  add column if not exists waste boolean not null default true;

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
            when 'waste' then np.waste
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

revoke execute on function public.send_push(uuid[], uuid, text, text, text, jsonb) from public, anon, authenticated;

-- Welche Tonnen werden an einem Tag abgeholt (Rhythmus + Verschiebungen)
create or replace function public.waste_collections_on(p_household_id uuid, p_date date)
returns setof public.waste_bins
language sql
stable
security definer
set search_path = ''
as $$
  select b.*
  from public.waste_bins b
  where b.household_id = p_household_id
    and (
      (
        (p_date - b.first_date) % (7 * b.interval_weeks) = 0
        and not exists (
          select 1 from public.waste_bin_changes c
          where c.bin_id = b.id and c.original_date = p_date
        )
      )
      or exists (
        select 1 from public.waste_bin_changes c
        where c.bin_id = b.id and c.new_date = p_date
      )
    )
  order by array_position(array['rest', 'papier', 'bio', 'gelb', 'sonstige'], b.kind), b.label;
$$;

revoke execute on function public.waste_collections_on(uuid, date) from public, anon, authenticated;

-- Am Vorabend: zur eigenen Erinnerungszeit, wenn die abends liegt, sonst um 19 Uhr
-- (eine Erinnerung am Abholmorgen käme zu spät — die Tonnen müssen früh draußen sein)
create or replace function public.send_waste_reminders(p_local_now timestamp default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_now timestamp := coalesce(p_local_now, now() at time zone 'Europe/Berlin');
  current_hour int := extract(hour from local_now)::int;
  tomorrow date := local_now::date + 1;
  household record;
  labels text[];
  recipients uuid[];
begin
  for household in
    select distinct household_id from public.waste_bins
  loop
    select array_agg(label) into labels
    from public.waste_collections_on(household.household_id, tomorrow);

    if labels is null then
      continue;
    end if;

    select coalesce(array_agg(m.user_id), '{}') into recipients
    from public.household_members m
    left join public.notification_prefs np on np.user_id = m.user_id
    where m.household_id = household.household_id
      and (case when coalesce(np.reminder_hour, 18) >= 12 then coalesce(np.reminder_hour, 18) else 19 end)
          = current_hour;

    perform public.send_push(
      recipients,
      household.household_id,
      'waste',
      '🗑️ Morgen wird abgeholt',
      case
        when cardinality(labels) = 1 then labels[1]
        else array_to_string(labels[1:cardinality(labels) - 1], ', ') || ' und ' || labels[cardinality(labels)]
      end || ' – heute Abend rausstellen',
      jsonb_build_object('url', '/calendar')
    );
  end loop;
end;
$$;

revoke execute on function public.send_waste_reminders(timestamp) from public, anon, authenticated;

select cron.schedule('muell-erinnerungen', '0 * * * *', 'select public.send_waste_reminders()');
