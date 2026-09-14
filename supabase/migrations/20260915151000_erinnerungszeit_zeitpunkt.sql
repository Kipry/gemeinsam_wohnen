-- send_chore_reminders nimmt optional einen Zeitpunkt (Ortszeit Berlin) —
-- der Cron-Job ruft ohne auf, Tests können so jede Stunde durchspielen.

drop function if exists public.send_chore_reminders();

create or replace function public.send_chore_reminders(p_local_now timestamp default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_now timestamp := coalesce(p_local_now, now() at time zone 'Europe/Berlin');
  current_hour int := extract(hour from local_now)::int;
  today date := local_now::date;
  reminder record;
  titles text[];
begin
  for reminder in
    select due.household_id, due.user_id, due.for_today, array_agg(distinct due.title) as titles
    from (
      select o.household_id, t.title, o.due_date = today as for_today,
             coalesce(o.assigned_to, tm.user_id) as user_id
      from public.task_occurrences o
      join public.tasks t on t.id = o.task_id
      left join public.team_members tm on tm.team_id = o.assigned_team_id
      where o.status = 'open'
        and o.due_date in (today, today + 1)
    ) due
    left join public.notification_prefs np on np.user_id = due.user_id
    where due.user_id is not null
      and coalesce(np.reminder_hour, 18) = current_hour
      and due.for_today = (coalesce(np.reminder_hour, 18) < 12)
    group by due.household_id, due.user_id, due.for_today
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
