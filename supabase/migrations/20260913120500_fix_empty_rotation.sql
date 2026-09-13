-- generate_occurrence() stürzte ab, wenn die Rotationsschleife niemanden fand:
-- der Record "chosen" blieb unbelegt und der folgende INSERT lief in
-- "record chosen is not assigned yet". Passiert in zwei realen Fällen:
--   1. Rotationsaufgabe ohne Einträge in task_rotation
--   2. alle Personen der Rotation sind am Fälligkeitstag abwesend
-- Fall 2 traf auch complete_occurrence() — die Aufgabe ließ sich dann gar
-- nicht mehr abhaken. Findet die Schleife niemanden, entsteht der Termin
-- jetzt ohne Zuteilung: wer mag, macht ihn.

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
  has_chosen boolean := false;
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
    has_chosen := true;
    exit;
  end loop;

  if has_chosen then
    insert into public.task_occurrences (
      task_id, household_id, due_date, assigned_to, assigned_team_id, rotation_position
    )
    values (
      t.id, t.household_id, p_due, chosen.user_id, chosen.team_id, chosen.position
    )
    returning * into occ;
  else
    insert into public.task_occurrences (task_id, household_id, due_date, rotation_position)
    values (t.id, t.household_id, p_due, p_after_position)
    returning * into occ;
  end if;

  return occ;
end;
$$;

revoke all on function public.generate_occurrence(uuid, date, int) from public, anon, authenticated;
