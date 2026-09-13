-- Putzplan: Teams, Aufgaben, Rotation, Termine, Tracking

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (team_id, user_id)
);

create type public.assignment_mode as enum ('anyone', 'rotation_member', 'rotation_team', 'fixed');

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null,
  description text,
  points int not null default 1 check (points > 0),
  interval_days int not null default 7 check (interval_days > 0),
  assignment_mode public.assignment_mode not null default 'anyone',
  fixed_assignee uuid references public.profiles (id),
  skip_absent boolean not null default true,
  active boolean not null default true,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

-- Reihenfolge der Rotation: entweder Personen oder Teams, je nach assignment_mode
create table public.task_rotation (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  position int not null,
  user_id uuid references public.profiles (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  unique (task_id, position),
  check (num_nonnulls(user_id, team_id) = 1)
);

create table public.task_occurrences (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  due_date date not null,
  assigned_to uuid references public.profiles (id),
  assigned_team_id uuid references public.teams (id) on delete set null,
  rotation_position int,
  status text not null default 'open' check (status in ('open', 'done', 'skipped')),
  completed_by uuid references public.profiles (id),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index on public.teams (household_id);
create index on public.team_members (user_id);
create index on public.tasks (household_id);
create index on public.task_rotation (task_id);
create index on public.task_occurrences (household_id, status, due_date);
create index on public.task_occurrences (task_id);

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_rotation enable row level security;
alter table public.task_occurrences enable row level security;

create policy "Teams der eigenen WG"
  on public.teams for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "Teammitglieder der eigenen WG"
  on public.team_members for all to authenticated
  using (exists (
    select 1 from public.teams t
    where t.id = team_id and public.is_household_member(t.household_id)
  ))
  with check (exists (
    select 1 from public.teams t
    where t.id = team_id and public.is_household_member(t.household_id)
  ));

create policy "Aufgaben der eigenen WG"
  on public.tasks for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "Rotation der eigenen WG"
  on public.task_rotation for all to authenticated
  using (exists (
    select 1 from public.tasks t
    where t.id = task_id and public.is_household_member(t.household_id)
  ))
  with check (exists (
    select 1 from public.tasks t
    where t.id = task_id and public.is_household_member(t.household_id)
  ));

create policy "Termine der eigenen WG"
  on public.task_occurrences for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- Nächsten Termin erzeugen; bei Rotation rückt der/die Nächste nach.
-- Abwesende werden übersprungen, wenn skip_absent gesetzt ist.
create function public.generate_occurrence(
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

  -- Rotationsreihenfolge ab der Position nach der letzten, mit Umbruch auf den Anfang
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

-- Aufgabe abhaken: markiert erledigt und legt den Folgetermin an
create function public.complete_occurrence(p_occurrence_id uuid)
returns public.task_occurrences
language plpgsql
security definer
set search_path = ''
as $$
declare
  occ public.task_occurrences;
  t public.tasks;
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

  select * into t from public.tasks where id = occ.task_id;

  update public.task_occurrences
  set status = 'done', completed_by = auth.uid(), completed_at = now()
  where id = occ.id
  returning * into occ;

  perform public.generate_occurrence(
    t.id,
    greatest(occ.due_date, current_date) + t.interval_days,
    occ.rotation_position
  );

  return occ;
end;
$$;

revoke all on function public.generate_occurrence(uuid, date, int) from public, anon;
revoke all on function public.complete_occurrence(uuid) from public, anon;
grant execute on function public.generate_occurrence(uuid, date, int) to authenticated;
grant execute on function public.complete_occurrence(uuid) to authenticated;

-- Wer ist für einen offenen Termin zuständig? (Person direkt oder über das Team)
create view public.occurrence_responsibles with (security_invoker = on) as
select o.id as occurrence_id, o.household_id, o.task_id, o.due_date, o.status, o.assigned_to as user_id
from public.task_occurrences o
where o.assigned_to is not null
union all
select o.id, o.household_id, o.task_id, o.due_date, o.status, tm.user_id
from public.task_occurrences o
join public.team_members tm on tm.team_id = o.assigned_team_id;

-- Tracking: erledigte Punkte, Pünktlichkeit und offene Zuweisungen pro Person
create view public.chore_stats_view with (security_invoker = on) as
select
  hm.household_id,
  hm.user_id,
  coalesce(d.tasks_done, 0)::bigint as tasks_done,
  coalesce(d.points_done, 0)::bigint as points_done,
  coalesce(d.done_on_time, 0)::bigint as done_on_time,
  coalesce(a.open_assigned, 0)::bigint as open_assigned,
  coalesce(a.overdue_assigned, 0)::bigint as overdue_assigned
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
  where o.status = 'done' and o.completed_by is not null
  group by 1, 2
) d on d.household_id = hm.household_id and d.user_id = hm.user_id
left join (
  select
    r.household_id,
    r.user_id,
    count(*) filter (where r.status = 'open') as open_assigned,
    count(*) filter (where r.status = 'open' and r.due_date < current_date) as overdue_assigned
  from public.occurrence_responsibles r
  group by 1, 2
) a on a.household_id = hm.household_id and a.user_id = hm.user_id;
