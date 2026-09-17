-- Putzplan: Statistik neu starten
--
-- Solange Mitbewohner nur als Platzhalter drinstehen, sammeln sie überfällige
-- Aufgaben an und der Gründer allein die Punkte. Wer dann beitritt, erbt die
-- Altlasten, und die Statistik zeigt ein schiefes Bild. Ein Neustart setzt
-- einen Stichtag: Punkte zählen erst ab dann, liegengebliebene Aufgaben von
-- vorher fallen weg. Die Historie selbst bleibt erhalten.
--
-- Weil es um Fairness geht, passiert das nicht heimlich: Im Chat steht, wer
-- neu gestartet hat.

alter table public.households add column stats_since timestamptz;

create or replace view public.chore_stats_view
with (security_invoker = on) as
select
  hm.household_id,
  hm.user_id,
  coalesce(d.tasks_done, 0::bigint) as tasks_done,
  coalesce(d.points_done, 0::bigint) as points_done,
  coalesce(d.done_on_time, 0::bigint) as done_on_time,
  coalesce(a.open_assigned, 0::bigint) as open_assigned,
  coalesce(a.overdue_assigned, 0::bigint) as overdue_assigned
from public.household_members hm
left join (
  select
    o.household_id,
    o.completed_by as user_id,
    count(*) as tasks_done,
    sum(t.points) as points_done,
    count(*) filter (where o.completed_at::date <= o.due_date) as done_on_time
  from public.task_occurrences o
  join public.tasks t on t.id = o.task_id
  join public.households h on h.id = o.household_id
  where o.status = 'done'
    and o.completed_by is not null
    and (h.stats_since is null or o.completed_at >= h.stats_since)
  group by o.household_id, o.completed_by
) d on d.household_id = hm.household_id and d.user_id = hm.user_id
left join (
  select
    r.household_id,
    r.user_id,
    count(*) filter (where r.status = 'open') as open_assigned,
    count(*) filter (where r.status = 'open' and r.due_date < current_date) as overdue_assigned
  from public.occurrence_responsibles r
  group by r.household_id, r.user_id
) a on a.household_id = hm.household_id and a.user_id = hm.user_id;

create function public.restart_chore_stats(p_household_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  skipped int;
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'Keine Berechtigung';
  end if;

  update public.households set stats_since = now() where id = p_household_id;

  -- Liegengebliebenes von vorher ist nicht mehr offen und zählt für niemanden
  update public.task_occurrences
  set status = 'skipped'
  where household_id = p_household_id and status = 'open' and due_date < current_date;
  get diagnostics skipped = row_count;

  perform public.post_chat_event(
    p_household_id, auth.uid(),
    'hat den Putzplan neu gestartet – Punkte zählen ab jetzt für alle von vorn',
    'households', p_household_id
  );

  return skipped;
end;
$$;

revoke execute on function public.restart_chore_stats(uuid) from public, anon;
grant execute on function public.restart_chore_stats(uuid) to authenticated;
