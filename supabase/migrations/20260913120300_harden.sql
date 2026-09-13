-- Absicherung der SECURITY-DEFINER-Funktionen
--
-- generate_occurrence() lief ohne Mitgliedschaftsprüfung und war für alle
-- angemeldeten Nutzer per RPC erreichbar. Ab jetzt: interne Funktion, Aufruf
-- nur über create_task()/complete_occurrence(), beide mit Prüfung.

create or replace function public.generate_occurrence(
  p_task_id uuid,
  p_due date,
  p_after_position int default null
)
returns public.task_occurrences
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
  candidate record;
  chosen record;
  is_absent boolean;
  occ public.task_occurrences;
  start_pos int;
begin
  select * into t from public.tasks where id = p_task_id;
  if not found or not t.active then
    return null;
  end if;

  if not public.is_household_member(t.household_id) then
    raise exception 'Keine Berechtigung';
  end if;

  if t.assignment_mode = 'fixed' then
    insert into public.task_occurrences (task_id, household_id, due_date, assigned_to)
    values (t.id, t.household_id, p_due, t.fixed_assignee)
    returning * into occ;
    return occ;
  end if;

  if t.assignment_mode = 'anyone' then
    insert into public.task_occurrences (task_id, household_id, due_date)
    values (t.id, t.household_id, p_due)
    returning * into occ;
    return occ;
  end if;

  start_pos := coalesce(p_after_position, -1);

  for candidate in
    select r.*
    from public.task_rotation r
    where r.task_id = t.id
    order by (r.position <= start_pos), r.position
  loop
    if t.skip_absent and candidate.user_id is not null then
      select exists (
        select 1 from public.absences a
        where a.user_id = candidate.user_id
          and a.household_id = t.household_id
          and p_due between a.start_date and a.end_date
      ) into is_absent;

      if is_absent then
        continue;
      end if;
    end if;

    chosen := candidate;
    exit;
  end loop;

  insert into public.task_occurrences (
    task_id, household_id, due_date, assigned_to, assigned_team_id, rotation_position
  )
  values (
    t.id, t.household_id, p_due, chosen.user_id, chosen.team_id, chosen.position
  )
  returning * into occ;

  return occ;
end;
$$;

-- Aufgabe + Rotationsreihenfolge + erster Termin in einem Aufruf.
-- p_rotation: geordnete Liste, z.B. [{"user_id": "..."}, {"user_id": "..."}]
-- oder [{"team_id": "..."}, ...] — je nach assignment_mode.
create function public.create_task(
  p_household_id uuid,
  p_title text,
  p_points int default 1,
  p_interval_days int default 7,
  p_assignment_mode public.assignment_mode default 'anyone',
  p_rotation jsonb default '[]'::jsonb,
  p_fixed_assignee uuid default null,
  p_skip_absent boolean default true,
  p_first_due date default current_date,
  p_description text default null
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'Keine Berechtigung';
  end if;

  if length(trim(coalesce(p_title, ''))) = 0 then
    raise exception 'Titel darf nicht leer sein';
  end if;

  insert into public.tasks (
    household_id, title, description, points, interval_days,
    assignment_mode, fixed_assignee, skip_absent, created_by
  )
  values (
    p_household_id, trim(p_title), nullif(trim(coalesce(p_description, '')), ''),
    greatest(coalesce(p_points, 1), 1), greatest(coalesce(p_interval_days, 7), 1),
    p_assignment_mode, p_fixed_assignee, coalesce(p_skip_absent, true), auth.uid()
  )
  returning * into t;

  if p_assignment_mode in ('rotation_member', 'rotation_team') then
    insert into public.task_rotation (task_id, position, user_id, team_id)
    select
      t.id,
      (ord - 1)::int,
      (elem ->> 'user_id')::uuid,
      (elem ->> 'team_id')::uuid
    from jsonb_array_elements(coalesce(p_rotation, '[]'::jsonb)) with ordinality as e(elem, ord);
  end if;

  perform public.generate_occurrence(t.id, coalesce(p_first_due, current_date), null);

  return t;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.generate_occurrence(uuid, date, int) from public, anon, authenticated;
revoke all on function public.create_task(uuid, text, int, int, public.assignment_mode, jsonb, uuid, boolean, date, text) from public, anon;
grant execute on function public.create_task(uuid, text, int, int, public.assignment_mode, jsonb, uuid, boolean, date, text) to authenticated;
