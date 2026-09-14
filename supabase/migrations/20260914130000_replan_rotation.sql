-- Meldet sich jemand ab, wurde bisher nur der betroffene Termin neu vergeben.
-- Der Rest des Plans blieb stehen — bei zwei Personen bekam der Einspringer
-- dadurch drei Termine hintereinander (B, B, B, A statt B, B, A, B).
--
-- Jetzt wird ab dem betroffenen Datum der komplette weitere Plan der Aufgabe
-- neu verteilt. Gleiches gilt, wenn eine Abwesenheit zurückgenommen wird.

create function public.replan_task_from(p_task_id uuid, p_from date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  planned date[];
  d date;
  prev_pos int;
begin
  select array_agg(due_date order by due_date) into planned
  from public.task_occurrences
  where task_id = p_task_id and status = 'open' and due_date >= p_from;

  if planned is null then
    return;
  end if;

  -- Rotationsstand auf den letzten Termin davor zurücksetzen
  select rotation_position into prev_pos
  from public.task_occurrences
  where task_id = p_task_id and due_date < p_from
  order by due_date desc
  limit 1;

  delete from public.task_occurrences
  where task_id = p_task_id and status = 'open' and due_date >= p_from;

  update public.tasks set current_position = prev_pos where id = p_task_id;

  foreach d in array planned loop
    perform public.create_occurrence(p_task_id, d);
  end loop;
end;
$$;

create or replace function public.reassign_absent_occurrences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record;
  affected record;
begin
  if tg_op = 'DELETE' then
    rec := old;
  else
    rec := new;
  end if;

  for affected in
    select distinct o.task_id
    from public.task_occurrences o
    join public.tasks t on t.id = o.task_id
    where o.household_id = rec.household_id
      and o.status = 'open'
      and o.due_date between rec.start_date and rec.end_date
      and t.skip_absent
      and t.assignment_mode = 'rotation_member'
  loop
    perform public.replan_task_from(affected.task_id, rec.start_date);
  end loop;

  return null;
end;
$$;

drop trigger on_absence_created on public.absences;

create trigger on_absence_changed
  after insert or delete on public.absences
  for each row execute function public.reassign_absent_occurrences();

revoke all on function public.replan_task_from(uuid, date) from public, anon, authenticated;
