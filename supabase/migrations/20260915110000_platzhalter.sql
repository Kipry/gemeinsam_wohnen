-- WG-Einstieg mit Platzhaltern
--
-- Bisher saß der Gründer vor einer leeren App: bevor der Putzplan irgendwas
-- taugt, mussten erst alle Mitbewohner beigetreten sein, damit man sie in
-- eine Rotation stecken kann. Genau in diesen ersten fünf Minuten geben WGs
-- eine App wieder auf.
--
-- Jetzt legt der Gründer die Mitbewohner als Platzhalter an ("Lisa", "Tom").
-- Die Rotation läuft sofort mit ihnen. Wer später beitritt, wählt "Ich bin
-- Lisa" und übernimmt Platz und Termine des Platzhalters.

create table public.household_placeholders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  claimed_by uuid references public.profiles (id) on delete set null,
  claimed_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index on public.household_placeholders (household_id) where claimed_by is null;

alter table public.household_placeholders enable row level security;

create policy "Platzhalter der eigenen WG lesen"
  on public.household_placeholders for select to authenticated
  using (public.is_household_member(household_id));

create policy "Platzhalter anlegen"
  on public.household_placeholders for insert to authenticated
  with check (public.is_household_member(household_id) and created_by = auth.uid() and claimed_by is null);

-- Übernehmen und Entfernen laufen über Funktionen, weil dabei Rotation und
-- Termine mitziehen müssen.

alter table public.task_rotation
  add column placeholder_id uuid references public.household_placeholders (id) on delete cascade;

alter table public.task_rotation drop constraint task_rotation_check;
alter table public.task_rotation
  add constraint task_rotation_check check (num_nonnulls(user_id, team_id, placeholder_id) = 1);

alter table public.task_occurrences
  add column assigned_placeholder_id uuid references public.household_placeholders (id) on delete set null;

-- ───────────────────────────────────────────── Rotation kennt Platzhalter
create or replace function public.create_occurrence(p_task_id uuid, p_due date)
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

  for candidate in
    select r.*
    from public.task_rotation r
    where r.task_id = t.id
    order by (r.position <= start_pos), r.position
  loop
    -- Platzhalter können nicht abwesend sein, nur echte Personen
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
      task_id, household_id, due_date, assigned_to, assigned_team_id,
      assigned_placeholder_id, rotation_position
    )
    values (
      t.id, t.household_id, p_due, chosen.user_id, chosen.team_id,
      chosen.placeholder_id, chosen.position
    )
    on conflict (task_id, due_date) do nothing
    returning * into occ;

    if occ.id is not null then
      update public.tasks set current_position = chosen.position where id = t.id;
    end if;
  else
    insert into public.task_occurrences (task_id, household_id, due_date, rotation_position)
    values (t.id, t.household_id, p_due, t.current_position)
    on conflict (task_id, due_date) do nothing
    returning * into occ;
  end if;

  return occ;
end;
$$;

-- Rotationseinträge dürfen jetzt auch {"placeholder_id": ...} sein
create or replace function public.create_task(
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
    insert into public.task_rotation (task_id, position, user_id, team_id, placeholder_id)
    select t.id, (ord - 1)::int,
           (elem ->> 'user_id')::uuid, (elem ->> 'team_id')::uuid, (elem ->> 'placeholder_id')::uuid
    from jsonb_array_elements(coalesce(p_rotation, '[]'::jsonb)) with ordinality as e(elem, ord);
  end if;

  perform public.create_occurrence(t.id, public.snap_weekday(coalesce(p_first_due, current_date), p_weekday));
  perform public.ensure_occurrences(p_household_id, 28);

  return t;
end;
$$;

create or replace function public.update_task(
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

-- ───────────────────────────────────────────── Übernehmen und Entfernen
-- "Ich bin Lisa": Rotationsplatz und offene Termine gehen an die neue Person.
create function public.claim_placeholder(p_placeholder_id uuid)
returns public.household_placeholders
language plpgsql
security definer
set search_path = ''
as $$
declare
  ph public.household_placeholders;
begin
  select * into ph from public.household_placeholders where id = p_placeholder_id;
  if not found then
    raise exception 'Platzhalter nicht gefunden';
  end if;

  if not public.is_household_member(ph.household_id) then
    raise exception 'Keine Berechtigung';
  end if;

  if ph.claimed_by is not null then
    raise exception 'Dieser Platz wurde schon übernommen';
  end if;

  if exists (
    select 1 from public.household_placeholders
    where household_id = ph.household_id and claimed_by = auth.uid()
  ) then
    raise exception 'Du hast in dieser WG schon einen Platz übernommen';
  end if;

  -- Stand man selbst schon in einer Rotation, fällt der Platzhalter dort nur
  -- weg — sonst wäre man in dieser Aufgabe doppelt dran.
  delete from public.task_rotation r
  where r.placeholder_id = ph.id
    and exists (
      select 1 from public.task_rotation mine
      where mine.task_id = r.task_id and mine.user_id = auth.uid()
    );

  update public.task_rotation
  set user_id = auth.uid(), placeholder_id = null
  where placeholder_id = ph.id;

  update public.task_occurrences
  set assigned_to = auth.uid(), assigned_placeholder_id = null
  where assigned_placeholder_id = ph.id and status = 'open';

  update public.household_placeholders
  set claimed_by = auth.uid(), claimed_at = now()
  where id = ph.id
  returning * into ph;

  return ph;
end;
$$;

-- Platzhalter, der doch nicht einzieht: raus aus allen Rotationen, offene
-- Termine neu verteilen.
create function public.remove_placeholder(p_placeholder_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ph public.household_placeholders;
  task_ids uuid[];
  task_id uuid;
begin
  select * into ph from public.household_placeholders where id = p_placeholder_id;
  if not found then
    raise exception 'Platzhalter nicht gefunden';
  end if;

  if not public.is_household_member(ph.household_id) then
    raise exception 'Keine Berechtigung';
  end if;

  if ph.claimed_by is not null then
    raise exception 'Dieser Platz ist schon übernommen und kann nicht mehr entfernt werden';
  end if;

  -- Vor dem Löschen merken: die Rotationseinträge verschwinden per Kaskade
  select array_agg(distinct r.task_id) into task_ids
  from public.task_rotation r
  where r.placeholder_id = ph.id;

  delete from public.household_placeholders where id = ph.id;

  if task_ids is not null then
    foreach task_id in array task_ids loop
      perform public.replan_task_from(task_id, current_date);
    end loop;
  end if;
end;
$$;

revoke all on function public.claim_placeholder(uuid) from public, anon;
revoke all on function public.remove_placeholder(uuid) from public, anon;
grant execute on function public.claim_placeholder(uuid) to authenticated;
grant execute on function public.remove_placeholder(uuid) to authenticated;

alter publication supabase_realtime add table public.household_placeholders;
