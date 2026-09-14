-- Routine bearbeiten, ohne den Plan umzuwerfen
--
-- Bisher hat jedes Speichern alle offenen Termine neu angelegt und die Rotation
-- von vorn begonnen — auch wenn nur der Name, die Punkte oder die Notiz geändert
-- wurden. Mit Checklisten bearbeitet man Routinen öfter, deshalb wird jetzt nur
-- noch neu geplant, wenn sich am Zeitplan oder an der Zuteilung etwas ändert.

create or replace function public.update_task(
  p_task_id uuid,
  p_title text,
  p_points integer,
  p_interval_days integer,
  p_assignment_mode public.assignment_mode,
  p_rotation jsonb default '[]'::jsonb,
  p_fixed_assignee uuid default null,
  p_skip_absent boolean default true,
  p_active boolean default true,
  p_description text default null,
  p_weekday integer default null
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
  keep_due date;
  old_rotation jsonb;
  new_rotation jsonb;
  schedule_changed boolean;
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

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', r.user_id, 'team_id', r.team_id, 'placeholder_id', r.placeholder_id
         ) order by r.position), '[]'::jsonb)
  into old_rotation
  from public.task_rotation r
  where r.task_id = t.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', (elem ->> 'user_id')::uuid,
           'team_id', (elem ->> 'team_id')::uuid,
           'placeholder_id', (elem ->> 'placeholder_id')::uuid
         ) order by ord), '[]'::jsonb)
  into new_rotation
  from jsonb_array_elements(
    case when p_assignment_mode in ('rotation_member', 'rotation_team')
      then coalesce(p_rotation, '[]'::jsonb) else '[]'::jsonb end
  ) with ordinality as e(elem, ord);

  schedule_changed :=
    t.interval_days is distinct from greatest(coalesce(p_interval_days, 7), 1)
    or t.assignment_mode is distinct from p_assignment_mode
    or t.fixed_assignee is distinct from p_fixed_assignee
    or t.skip_absent is distinct from coalesce(p_skip_absent, true)
    or t.weekday is distinct from p_weekday
    or t.active is distinct from coalesce(p_active, true)
    or old_rotation is distinct from new_rotation;

  if not schedule_changed then
    update public.tasks
    set title = trim(p_title),
        description = nullif(trim(coalesce(p_description, '')), ''),
        points = greatest(coalesce(p_points, 1), 1)
    where id = t.id
    returning * into t;
    return t;
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
      weekday = p_weekday,
      active = coalesce(p_active, true),
      current_position = null
  where id = t.id
  returning * into t;

  delete from public.task_rotation where task_id = t.id;

  if p_assignment_mode in ('rotation_member', 'rotation_team') then
    insert into public.task_rotation (task_id, position, user_id, team_id, placeholder_id)
    select t.id, (ord - 1)::int,
           (elem ->> 'user_id')::uuid, (elem ->> 'team_id')::uuid, (elem ->> 'placeholder_id')::uuid
    from jsonb_array_elements(coalesce(p_rotation, '[]'::jsonb)) with ordinality as e(elem, ord);
  end if;

  delete from public.task_occurrences where task_id = t.id and status = 'open';

  if t.active then
    perform public.create_occurrence(t.id, public.snap_weekday(coalesce(keep_due, current_date), t.weekday));
    perform public.ensure_occurrences(t.household_id, 28);
  end if;

  return t;
end;
$$;
