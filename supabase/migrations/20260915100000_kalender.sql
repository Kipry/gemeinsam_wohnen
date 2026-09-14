-- Kalender: gemeinsame Termine neben Abwesenheiten
--
-- Abwesenheiten bleiben eine eigene Tabelle — sie gehören einer Person und
-- steuern die Putzplan-Rotation. Gemeinsame Termine (WG-Abend, Besuch,
-- Handwerker) gehören der ganzen WG und haben eine Zusage-Liste.
-- Der Kalender in der App zeigt beides zusammen.

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  kind text not null default 'termin'
    check (kind in ('termin', 'wg_abend', 'besuch', 'handwerker', 'geburtstag')),
  title text not null check (length(trim(title)) > 0),
  note text,
  starts_on date not null,
  ends_on date not null,
  start_time time,
  end_time time,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  check (ends_on >= starts_on),
  -- Endzeit nur zusammen mit Startzeit; am selben Tag nicht vor dem Start
  check (end_time is null or start_time is not null),
  check (ends_on > starts_on or end_time is null or end_time >= start_time)
);

create table public.calendar_event_attendees (
  event_id uuid not null references public.calendar_events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'yes' check (status in ('yes', 'no')),
  responded_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index on public.calendar_events (household_id, starts_on);
create index on public.calendar_events (household_id, ends_on);
create index on public.calendar_event_attendees (user_id);

alter table public.calendar_events enable row level security;
alter table public.calendar_event_attendees enable row level security;

create policy "Termine der eigenen WG lesen"
  on public.calendar_events for select to authenticated
  using (public.is_household_member(household_id));

create policy "Termin eintragen"
  on public.calendar_events for insert to authenticated
  with check (public.is_household_member(household_id) and created_by = auth.uid());

create policy "Termine der eigenen WG bearbeiten"
  on public.calendar_events for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "Termine der eigenen WG löschen"
  on public.calendar_events for delete to authenticated
  using (public.is_household_member(household_id));

create policy "Zusagen der eigenen WG lesen"
  on public.calendar_event_attendees for select to authenticated
  using (exists (
    select 1 from public.calendar_events e
    where e.id = event_id and public.is_household_member(e.household_id)
  ));

-- Zu- oder absagen darf man nur für sich selbst
create policy "eigene Zusage verwalten"
  on public.calendar_event_attendees for all to authenticated
  using (user_id = auth.uid() and exists (
    select 1 from public.calendar_events e
    where e.id = event_id and public.is_household_member(e.household_id)
  ))
  with check (user_id = auth.uid() and exists (
    select 1 from public.calendar_events e
    where e.id = event_id and public.is_household_member(e.household_id)
  ));

-- Neuer Termin erscheint als Karte auf der Pinnwand
create function public.on_calendar_event_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.post_chat_event(
    new.household_id, new.created_by,
    case
      when new.starts_on = new.ends_on
        then format('hat „%s" am %s eingetragen', new.title, to_char(new.starts_on, 'DD.MM.'))
      else format('hat „%s" vom %s bis %s eingetragen',
                  new.title, to_char(new.starts_on, 'DD.MM.'), to_char(new.ends_on, 'DD.MM.'))
    end,
    'calendar_events', new.id
  );
  return new;
end;
$$;

create trigger on_calendar_event_inserted
  after insert on public.calendar_events
  for each row execute function public.on_calendar_event_created();

revoke all on function public.on_calendar_event_created() from public, anon, authenticated;

alter publication supabase_realtime add table public.calendar_events;
alter publication supabase_realtime add table public.calendar_event_attendees;
