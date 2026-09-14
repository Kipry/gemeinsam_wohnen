-- Block D, Teil 1: Brücke vom Einkauf zur Kostenaufteilung
--
-- Bisher musste man denselben Einkauf zweimal erfassen: einmal als Häkchen
-- auf der Liste, einmal als Ausgabe. In der Praxis lässt man das Zweite dann
-- bleiben und der Einkauf verfällt.
--
-- Jetzt: "Ich kauf ein" öffnet eine Einkaufs-Sitzung, alles dabei Abgehakte
-- gehört dazu, am Ende wird daraus mit einem Betrag eine geteilte Ausgabe.

create table public.shopping_trips (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  shopper uuid not null references public.profiles (id),
  store text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  total_cents bigint check (total_cents is null or total_cents > 0),
  expense_id uuid references public.expenses (id) on delete set null
);

alter table public.shopping_items
  add column trip_id uuid references public.shopping_trips (id) on delete set null;

create index on public.shopping_trips (household_id, finished_at);
create index on public.shopping_items (trip_id);

-- Pro Person höchstens eine laufende Sitzung; zwei Leute dürfen aber
-- gleichzeitig in verschiedenen Läden stehen.
create unique index shopping_trips_active_per_shopper
  on public.shopping_trips (household_id, shopper)
  where finished_at is null;

alter table public.shopping_trips enable row level security;

create policy "Einkäufe der eigenen WG"
  on public.shopping_trips for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id) and shopper = auth.uid());

create function public.start_shopping_trip(p_household_id uuid, p_store text default null)
returns public.shopping_trips
language plpgsql
security definer
set search_path = ''
as $$
declare
  trip public.shopping_trips;
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'Keine Berechtigung';
  end if;

  -- Läuft schon eine Sitzung, wird sie fortgesetzt statt eine zweite zu öffnen
  select * into trip
  from public.shopping_trips
  where household_id = p_household_id and shopper = auth.uid() and finished_at is null;

  if found then
    return trip;
  end if;

  insert into public.shopping_trips (household_id, shopper, store)
  values (p_household_id, auth.uid(), nullif(trim(coalesce(p_store, '')), ''))
  returning * into trip;

  return trip;
end;
$$;

-- Abgehakte Artikel der Sitzung in eine Ausgabe überführen.
-- p_shares wie bei create_expense: [{"user_id": ..., "share_cents": ...}, ...]
create function public.finish_shopping_trip(
  p_trip_id uuid,
  p_total_cents bigint,
  p_paid_by uuid,
  p_shares jsonb,
  p_title text default null,
  p_split_mode text default 'equal',
  p_store text default null
)
returns public.expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  trip public.shopping_trips;
  e public.expenses;
  artikel text;
  anzahl int;
begin
  select * into trip from public.shopping_trips where id = p_trip_id;
  if not found then
    raise exception 'Einkauf nicht gefunden';
  end if;

  if not public.is_household_member(trip.household_id) then
    raise exception 'Keine Berechtigung';
  end if;

  if trip.finished_at is not null then
    raise exception 'Dieser Einkauf ist bereits abgerechnet';
  end if;

  select count(*), string_agg(name, ', ' order by name)
  into anzahl, artikel
  from public.shopping_items
  where trip_id = trip.id and deleted_at is null;

  e := public.create_expense(
    trip.household_id,
    coalesce(nullif(trim(coalesce(p_title, '')), ''),
             coalesce(nullif(trim(coalesce(p_store, '')), ''), 'Einkauf')),
    p_total_cents,
    p_paid_by,
    p_shares,
    p_split_mode,
    'Lebensmittel',
    current_date,
    artikel
  );

  update public.shopping_trips
  set finished_at = now(),
      total_cents = p_total_cents,
      store = coalesce(nullif(trim(coalesce(p_store, '')), ''), store),
      expense_id = e.id
  where id = trip.id;

  return e;
end;
$$;

-- Einkauf beenden, ohne eine Ausgabe anzulegen (z.B. selbst bezahlt und egal)
create function public.cancel_shopping_trip(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  trip public.shopping_trips;
begin
  select * into trip from public.shopping_trips where id = p_trip_id;
  if not found then
    raise exception 'Einkauf nicht gefunden';
  end if;

  if not public.is_household_member(trip.household_id) then
    raise exception 'Keine Berechtigung';
  end if;

  update public.shopping_trips set finished_at = now() where id = trip.id;
end;
$$;

revoke all on function public.start_shopping_trip(uuid, text) from public, anon;
revoke all on function public.finish_shopping_trip(uuid, bigint, uuid, jsonb, text, text, text) from public, anon;
revoke all on function public.cancel_shopping_trip(uuid) from public, anon;
grant execute on function public.start_shopping_trip(uuid, text) to authenticated;
grant execute on function public.finish_shopping_trip(uuid, bigint, uuid, jsonb, text, text, text) to authenticated;
grant execute on function public.cancel_shopping_trip(uuid) to authenticated;

alter publication supabase_realtime add table public.shopping_trips;
