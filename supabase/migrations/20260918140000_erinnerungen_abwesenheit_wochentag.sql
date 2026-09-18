-- Erinnerungen nur an Anwesende; fester Wochentag nur bei ganzen Wochen

-- 1) Putz-Erinnerung: Wer am Fälligkeitstag abwesend ist, wird nicht erinnert.
--    Betrifft vor allem Teams — die Aufgabe bleibt beim Team, auch wenn ein
--    Mitglied weg ist, und die Erinnerung ging bisher an alle Mitglieder.
--    Die Auswahl steht in einer eigenen Funktion, damit sie sich ohne echten
--    Versand prüfen lässt.
create or replace function public.chore_reminder_recipients(p_local_now timestamp)
returns table (household_id uuid, user_id uuid, for_today boolean, titles text[])
language sql
stable
security definer
set search_path = ''
as $$
  select due.household_id, due.user_id, due.for_today, array_agg(distinct due.title) as titles
  from (
    select o.household_id, o.due_date, t.title, o.due_date = p_local_now::date as for_today,
           coalesce(o.assigned_to, tm.user_id) as user_id
    from public.task_occurrences o
    join public.tasks t on t.id = o.task_id
    left join public.team_members tm on tm.team_id = o.assigned_team_id
    where o.status = 'open'
      and o.due_date in (p_local_now::date, p_local_now::date + 1)
  ) due
  left join public.notification_prefs np on np.user_id = due.user_id
  where due.user_id is not null
    and coalesce(np.reminder_hour, 18) = extract(hour from p_local_now)::int
    and due.for_today = (coalesce(np.reminder_hour, 18) < 12)
    and not exists (
      select 1 from public.absences a
      where a.user_id = due.user_id
        and a.household_id = due.household_id
        and due.due_date between a.start_date and a.end_date
    )
  group by due.household_id, due.user_id, due.for_today;
$$;

revoke execute on function public.chore_reminder_recipients(timestamp) from public, anon, authenticated;

create or replace function public.send_chore_reminders(p_local_now timestamp default null)
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
    select * from public.chore_reminder_recipients(
      coalesce(p_local_now, now() at time zone 'Europe/Berlin')
    )
  loop
    titles := reminder.titles;
    perform public.send_push(
      array[reminder.user_id],
      reminder.household_id,
      'chores',
      case when reminder.for_today then '🧽 Heute bist du dran' else '🧽 Morgen bist du dran' end,
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

revoke execute on function public.send_chore_reminders(timestamp) from public, anon, authenticated;

-- 2) Müll-Erinnerung am Vorabend: Wer heute nicht da ist, kann die Tonnen nicht
--    rausstellen und wird deshalb nicht erinnert.
create or replace function public.waste_reminder_recipients(p_household_id uuid, p_local_now timestamp)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.user_id), '{}')
  from public.household_members m
  left join public.notification_prefs np on np.user_id = m.user_id
  where m.household_id = p_household_id
    and (case when coalesce(np.reminder_hour, 18) >= 12 then coalesce(np.reminder_hour, 18) else 19 end)
        = extract(hour from p_local_now)::int
    and not exists (
      select 1 from public.absences a
      where a.user_id = m.user_id
        and a.household_id = p_household_id
        and p_local_now::date between a.start_date and a.end_date
    );
$$;

revoke execute on function public.waste_reminder_recipients(uuid, timestamp) from public, anon, authenticated;

create or replace function public.send_waste_reminders(p_local_now timestamp default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_now timestamp := coalesce(p_local_now, now() at time zone 'Europe/Berlin');
  tomorrow date := local_now::date + 1;
  household record;
  labels text[];
begin
  for household in
    select distinct household_id from public.waste_bins
  loop
    select array_agg(label) into labels
    from public.waste_collections_on(household.household_id, tomorrow);

    if labels is null then
      continue;
    end if;

    perform public.send_push(
      public.waste_reminder_recipients(household.household_id, local_now),
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

-- 3) Fester Wochentag nur bei ganzen Wochen. Die Planung rückte bisher auf den
--    nächsten passenden Wochentag vor — „alle 3 Tage, dienstags" war in Wahrheit
--    jeden Dienstag, „alle 10 Tage, dienstags" jeden zweiten. Solche Aufgaben
--    bekommen den Rhythmus, den sie tatsächlich hatten; ältere App-Versionen
--    dürfen die Kombination weiter schicken, sie wird beim Speichern aufgerundet.
create or replace function public.round_weekday_interval()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.weekday is not null and new.interval_days % 7 <> 0 then
    new.interval_days := ((new.interval_days + 6) / 7) * 7;
  end if;
  return new;
end;
$$;

create trigger round_weekday_interval
  before insert or update of interval_days, weekday on public.tasks
  for each row execute function public.round_weekday_interval();

update public.tasks
set interval_days = ((interval_days + 6) / 7) * 7
where weekday is not null and interval_days % 7 <> 0;

alter table public.tasks
  add constraint tasks_weekday_whole_weeks check (weekday is null or interval_days % 7 = 0);
