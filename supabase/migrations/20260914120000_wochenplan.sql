-- Block C: Wochenplan
--
-- Bisher entstand ein Folgetermin ausschließlich beim Abhaken. Zwei Folgen:
--   1. Keine Vorausschau — niemand konnte sehen, wann er das nächste Mal dran ist.
--   2. Wer nicht abhakte, erzeugte nie einen neuen Termin. Die Aufgabe blieb als
--      "21 Tage überfällig" liegen und blockierte die ganze Rotation.
-- Dazu kam Termindrift: der Folgetermin hing am Abhak-Datum, nicht am Plan.
-- "Müll dienstags" wanderte so über Wochen auf Donnerstag.
--
-- Ab jetzt werden Termine im Voraus erzeugt (Standard: 4 Wochen), immer
-- ausgehend vom geplanten Vortermin. Der Rotationsstand steht an der Aufgabe
-- statt im letzten Termin.

alter table public.tasks
  add column weekday int check (weekday between 0 and 6),
  add column current_position int;

comment on column public.tasks.weekday is
  'Fester Wochentag (0=Sonntag .. 6=Samstag), null = kein Anker';

-- Verhindert doppelte Termine, wenn die Vorausplanung mehrfach läuft.
create unique index task_occurrences_task_due_key
  on public.task_occurrences (task_id, due_date);

alter table public.task_occurrences drop column generated_from;

-- Auf den nächsten passenden Wochentag vorrücken (0-6 Tage).
create function public.snap_weekday(p_date date, p_weekday int)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
    when p_weekday is null then p_date
    else p_date + ((p_weekday - extract(dow from p_date)::int + 7) % 7)
  end;
$$;

-- Einen einzelnen Termin anlegen und dabei die Rotation weiterdrehen.
-- Intern: wird nur aus ensure_occurrences und den Aufgaben-RPCs gerufen.
create function public.create_occurrence(p_task_id uuid, p_due date)
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

  if t.assignment_mode = 'fixed' then
    insert into public.task_occurrences (task_id, household_id, due_date, assigned_to)
    values (t.id, t.household_id, p_due, t.fixed_assignee)
    on conflict (task_id, due_date) do nothing
    returning * into occ;
    return occ;
  end if;

  if t.assignment_mode = 'anyone' then
    insert into public.task_occurrences (task_id, household_id, due_date)
    values (t.id, t.household_id, p_due)
    on conflict (task_id, due_date) do nothing
    returning * into occ;
    return occ;
  end if;

  start_pos := coalesce(t.current_position, -1);

  -- Ab der Position nach der zuletzt vergebenen, mit Umbruch auf den Anfang
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
    values (t.id, t.household_id, p_due, chosen.user_id, chosen.team_id, chosen.position)
    on conflict (task_id, due_date) do nothing
    returning * into occ;

    if occ.id is not null then
      update public.tasks set current_position = chosen.position where id = t.id;
    end if;
  else
    -- Alle abwesend: Termin bleibt offen für alle, Rotationsstand unverändert
    insert into public.task_occurrences (task_id, household_id, due_date, rotation_position)
    values (t.id, t.household_id, p_due, t.current_position)
    on conflict (task_id, due_date) do nothing
    returning * into occ;
  end if;

  return occ;
end;
$$;

-- Termine aller aktiven Aufgaben bis zum Horizont auffüllen.
-- Läuft beim Öffnen der App und ist absichtlich idempotent.
create function public.ensure_occurrences(p_household_id uuid, p_horizon_days int default 28)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
  new_occ public.task_occurrences;
  last_due date;
  next_due date;
  horizon date;
  created int := 0;
  guard int;
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'Keine Berechtigung';
  end if;

  horizon := current_date + greatest(coalesce(p_horizon_days, 28), 1);

  for t in
    select * from public.tasks where household_id = p_household_id and active
  loop
    select max(due_date) into last_due
    from public.task_occurrences where task_id = t.id;

    if last_due is null then
      next_due := public.snap_weekday(current_date, t.weekday);
    else
      next_due := public.snap_weekday(last_due + t.interval_days, t.weekday);
    end if;

    guard := 0;
    while next_due <= horizon and guard < 200 loop
      -- Feld prüfen, nicht den Verbund: "row is not null" ist in Postgres nur
      -- wahr, wenn jede einzelne Spalte gefüllt ist.
      new_occ := public.create_occurrence(t.id, next_due);
      if new_occ.id is not null then
        created := created + 1;
      end if;
      guard := guard + 1;
      next_due := public.snap_weekday(next_due + t.interval_days, t.weekday);
    end loop;
  end loop;

  return created;
end;
$$;

-- Abhaken erzeugt keinen Folgetermin mehr — der steht längst im Plan.
create or replace function public.complete_occurrence(p_occurrence_id uuid)
returns public.task_occurrences
language plpgsql
security definer
set search_path = ''
as $$
declare
  occ public.task_occurrences;
begin
  select * into occ from public.task_occurrences where id = p_occurrence_id;
  if not found then
    raise exception 'Termin nicht gefunden';
  end if;

  if not public.is_household_member(occ.household_id) then
    raise exception 'Keine Berechtigung';
  end if;

  if occ.status = 'done' then
    return occ;
  end if;

  update public.task_occurrences
  set status = 'done', completed_by = auth.uid(), completed_at = now()
  where id = occ.id
  returning * into occ;

  perform public.ensure_occurrences(occ.household_id, 28);

  return occ;
end;
$$;

create or replace function public.uncomplete_occurrence(p_occurrence_id uuid)
returns public.task_occurrences
language plpgsql
security definer
set search_path = ''
as $$
declare
  occ public.task_occurrences;
begin
  select * into occ from public.task_occurrences where id = p_occurrence_id;
  if not found then
    raise exception 'Termin nicht gefunden';
  end if;

  if not public.is_household_member(occ.household_id) then
    raise exception 'Keine Berechtigung';
  end if;

  update public.task_occurrences
  set status = 'open', completed_by = null, completed_at = null
  where id = occ.id
  returning * into occ;

  return occ;
end;
$$;

-- create_task / update_task / set_task_active auf die Vorausplanung umstellen.
-- Die alten Signaturen müssen weg: ein zusätzlicher Parameter erzeugt sonst
-- eine zweite Überladung, und PostgREST kann den Aufruf nicht mehr auflösen.
drop function public.create_task(uuid, text, int, int, public.assignment_mode, jsonb, uuid, boolean, date, text);
drop function public.update_task(uuid, text, int, int, public.assignment_mode, jsonb, uuid, boolean, boolean, text);

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
  p_description text default null,
  p_weekday int default null
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
    assignment_mode, fixed_assignee, skip_absent, weekday, created_by
  )
  values (
    p_household_id, trim(p_title), nullif(trim(coalesce(p_description, '')), ''),
    greatest(coalesce(p_points, 1), 1), greatest(coalesce(p_interval_days, 7), 1),
    p_assignment_mode, p_fixed_assignee, coalesce(p_skip_absent, true), p_weekday, auth.uid()
  )
  returning * into t;

  if p_assignment_mode in ('rotation_member', 'rotation_team') then
    insert into public.task_rotation (task_id, position, user_id, team_id)
    select t.id, (ord - 1)::int, (elem ->> 'user_id')::uuid, (elem ->> 'team_id')::uuid
    from jsonb_array_elements(coalesce(p_rotation, '[]'::jsonb)) with ordinality as e(elem, ord);
  end if;

  perform public.create_occurrence(t.id, public.snap_weekday(coalesce(p_first_due, current_date), p_weekday));
  perform public.ensure_occurrences(p_household_id, 28);

  return t;
end;
$$;

create function public.update_task(
  p_task_id uuid,
  p_title text,
  p_points int,
  p_interval_days int,
  p_assignment_mode public.assignment_mode,
  p_rotation jsonb default '[]'::jsonb,
  p_fixed_assignee uuid default null,
  p_skip_absent boolean default true,
  p_active boolean default true,
  p_description text default null,
  p_weekday int default null
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
  keep_due date;
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
    insert into public.task_rotation (task_id, position, user_id, team_id)
    select t.id, (ord - 1)::int, (elem ->> 'user_id')::uuid, (elem ->> 'team_id')::uuid
    from jsonb_array_elements(coalesce(p_rotation, '[]'::jsonb)) with ordinality as e(elem, ord);
  end if;

  -- Offene Termine neu planen, sonst bliebe eine veraltete Zuteilung stehen
  delete from public.task_occurrences where task_id = t.id and status = 'open';

  if t.active then
    perform public.create_occurrence(t.id, public.snap_weekday(coalesce(keep_due, current_date), t.weekday));
    perform public.ensure_occurrences(t.household_id, 28);
  end if;

  return t;
end;
$$;

create or replace function public.set_task_active(p_task_id uuid, p_active boolean)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where id = p_task_id;
  if not found then
    raise exception 'Aufgabe nicht gefunden';
  end if;

  if not public.is_household_member(t.household_id) then
    raise exception 'Keine Berechtigung';
  end if;

  update public.tasks set active = p_active where id = t.id returning * into t;

  delete from public.task_occurrences where task_id = t.id and status = 'open';

  if p_active then
    perform public.create_occurrence(t.id, public.snap_weekday(current_date, t.weekday));
    perform public.ensure_occurrences(t.household_id, 28);
  end if;

  return t;
end;
$$;

drop function public.generate_occurrence(uuid, date, int);

-- Wer sich abmeldet, soll aus bereits geplanten Terminen rausfallen.
-- Ohne das hätte das Melden einer Abwesenheit für den fertigen Plan keine Wirkung.
create function public.reassign_absent_occurrences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  occ record;
begin
  for occ in
    select o.id, o.task_id, o.due_date
    from public.task_occurrences o
    join public.tasks t on t.id = o.task_id
    where o.household_id = new.household_id
      and o.assigned_to = new.user_id
      and o.status = 'open'
      and o.due_date between new.start_date and new.end_date
      and t.skip_absent
      and t.assignment_mode = 'rotation_member'
  loop
    delete from public.task_occurrences where id = occ.id;
    perform public.create_occurrence(occ.task_id, occ.due_date);
  end loop;

  return new;
end;
$$;

create trigger on_absence_created
  after insert on public.absences
  for each row execute function public.reassign_absent_occurrences();

revoke all on function public.snap_weekday(date, int) from public, anon;
revoke all on function public.create_occurrence(uuid, date) from public, anon, authenticated;
revoke all on function public.reassign_absent_occurrences() from public, anon, authenticated;
revoke all on function public.ensure_occurrences(uuid, int) from public, anon;
revoke all on function public.create_task(uuid, text, int, int, public.assignment_mode, jsonb, uuid, boolean, date, text, int) from public, anon;
revoke all on function public.update_task(uuid, text, int, int, public.assignment_mode, jsonb, uuid, boolean, boolean, text, int) from public, anon;
grant execute on function public.ensure_occurrences(uuid, int) to authenticated;
grant execute on function public.create_task(uuid, text, int, int, public.assignment_mode, jsonb, uuid, boolean, date, text, int) to authenticated;
grant execute on function public.update_task(uuid, text, int, int, public.assignment_mode, jsonb, uuid, boolean, boolean, text, int) to authenticated;
