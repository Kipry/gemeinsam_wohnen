-- Teams: schon vorgemerkte Mitbewohner zuordnen
--
-- Platzhalter stehen im Putzplan längst in der Rotation, in Teams gingen sie
-- aber nicht — dabei legt man beides in derselben ersten Viertelstunde an.
-- team_members bekommt deshalb dieselbe Wahl wie task_rotation: entweder eine
-- Person oder ein Platzhalter. Beim Beitreten rückt der Platz nach.

alter table public.team_members
  drop constraint team_members_pkey,
  add column id uuid primary key default gen_random_uuid(),
  add column placeholder_id uuid references public.household_placeholders (id) on delete cascade,
  alter column user_id drop not null,
  add constraint team_members_check check (num_nonnulls(user_id, placeholder_id) = 1);

create unique index team_members_user_key
  on public.team_members (team_id, user_id) where user_id is not null;
create unique index team_members_placeholder_key
  on public.team_members (team_id, placeholder_id) where placeholder_id is not null;

-- Nur Platzhalter der WG, zu der das Team gehört
drop policy "Teammitglieder der eigenen WG" on public.team_members;

create policy "Teammitglieder der eigenen WG"
  on public.team_members for all to authenticated
  using (exists (
    select 1 from public.teams t
    where t.id = team_id and public.is_household_member(t.household_id)
  ))
  with check (exists (
    select 1 from public.teams t
    where t.id = team_id
      and public.is_household_member(t.household_id)
      and (
        placeholder_id is null
        or exists (
          select 1 from public.household_placeholders p
          where p.id = placeholder_id and p.household_id = t.household_id
        )
      )
  ));

-- Platzhalter erledigen nichts: aus der Zuständigkeit für Aufgaben heraushalten
create or replace view public.occurrence_responsibles
with (security_invoker = on) as
select o.id as occurrence_id, o.household_id, o.task_id, o.due_date, o.status, o.assigned_to as user_id
from public.task_occurrences o
where o.assigned_to is not null
union all
select o.id as occurrence_id, o.household_id, o.task_id, o.due_date, o.status, tm.user_id
from public.task_occurrences o
join public.team_members tm on tm.team_id = o.assigned_team_id
where tm.user_id is not null;

-- Beitreten: Platz in der Rotation und jetzt auch im Team übernehmen
create or replace function public.claim_placeholder(p_placeholder_id uuid)
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

  delete from public.task_rotation r
  where r.placeholder_id = ph.id
    and exists (
      select 1 from public.task_rotation mine
      where mine.task_id = r.task_id and mine.user_id = auth.uid()
    );

  update public.task_rotation
  set user_id = auth.uid(), placeholder_id = null
  where placeholder_id = ph.id;

  -- Wer im Team schon selbst drinsteht, würde sonst doppelt geführt
  delete from public.team_members tm
  where tm.placeholder_id = ph.id
    and exists (
      select 1 from public.team_members mine
      where mine.team_id = tm.team_id and mine.user_id = auth.uid()
    );

  update public.team_members
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
