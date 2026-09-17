-- Einkauf: Artikel, die nur man selbst sieht
--
-- Wer seine eigenen Sachen in einer zweiten Einkaufs-App führte, musste im
-- Laden zwischen zwei Listen hin und her. Private Artikel stehen jetzt in
-- derselben Liste und im richtigen Regal — aber nur für die Person, die sie
-- eingetragen hat. Das setzt die Datenbank durch, nicht die App.

alter table public.shopping_items
  add column private boolean not null default false;

drop policy "Einkaufsliste der eigenen WG" on public.shopping_items;

create policy "Einkaufsliste der eigenen WG lesen"
  on public.shopping_items for select to authenticated
  using (public.is_household_member(household_id)
         and (not private or added_by = (select auth.uid())));

create policy "Einkaufsliste: selbst eintragen"
  on public.shopping_items for insert to authenticated
  with check (public.is_household_member(household_id)
              and added_by = (select auth.uid()));

create policy "Einkaufsliste: abhaken und ändern"
  on public.shopping_items for update to authenticated
  using (public.is_household_member(household_id)
         and (not private or added_by = (select auth.uid())))
  with check (public.is_household_member(household_id)
              and (not private or added_by = (select auth.uid())));

create policy "Einkaufsliste: löschen"
  on public.shopping_items for delete to authenticated
  using (public.is_household_member(household_id)
         and (not private or added_by = (select auth.uid())));

-- Sonst könnte jemand einen fremden Artikel auf sich umschreiben und privat
-- stellen. Die App ändert nur diese Spalten; privat/gemeinsam läuft über die
-- Funktion unten.
revoke update on public.shopping_items from anon, authenticated;
grant update (quantity, category, status, bought_by, bought_at, trip_id, deleted_at)
  on public.shopping_items to authenticated;

create function public.set_shopping_item_private(p_item_id uuid, p_private boolean)
returns public.shopping_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.shopping_items;
begin
  select * into item
  from public.shopping_items
  where id = p_item_id and deleted_at is null;

  if not found
     or not public.is_household_member(item.household_id)
     or (item.private and item.added_by <> auth.uid()) then
    raise exception 'Artikel nicht gefunden';
  end if;
  if item.added_by <> auth.uid() then
    raise exception 'Nur wer den Artikel eingetragen hat, kann ihn privat machen';
  end if;
  if item.private = p_private then
    return item;
  end if;

  if p_private then
    -- Neu anlegen statt umschalten: Eine Änderung, die die anderen danach nicht
    -- mehr lesen dürfen, schickt ihnen die Echtzeit nicht — der Artikel bliebe
    -- bei ihnen stehen. Ein Löschen kommt dagegen bei allen an.
    delete from public.shopping_items where id = item.id;
    item.id := gen_random_uuid();
    item.private := true;
    insert into public.shopping_items select item.*;
    return item;
  end if;

  update public.shopping_items
  set private = false
  where id = item.id
  returning * into item;
  return item;
end;
$$;

-- Wer auszieht oder sein Konto löscht, hinterlässt keine privaten Artikel
create function public.drop_private_shopping_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.shopping_items
  where household_id = old.household_id and added_by = old.user_id and private;
  return old;
end;
$$;

create trigger drop_private_shopping_items
  after delete on public.household_members
  for each row execute function public.drop_private_shopping_items();

-- ───────────────────────────────────────────── Private Artikel verraten sich nicht
-- „Ben geht einkaufen – 3 Sachen stehen auf der Liste" zählt nur gemeinsame
create or replace function public.push_on_shopping_trip()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  open_items int;
begin
  select count(*) into open_items
  from public.shopping_items
  where household_id = new.household_id and status = 'open' and deleted_at is null and not private;

  perform public.send_push(
    public.household_member_ids(new.household_id, new.shopper),
    new.household_id,
    'shopping',
    '🛒 ' || public.display_name(new.shopper) || ' geht einkaufen'
      || coalesce(' (' || nullif(new.store, '') || ')', ''),
    case
      when open_items = 0 then 'Die Liste ist leer – brauchst du was?'
      when open_items = 1 then '1 Sache steht auf der Liste. Fehlt noch was?'
      else open_items || ' Sachen stehen auf der Liste. Fehlt noch was?'
    end,
    jsonb_build_object('url', '/shopping')
  );
  return new;
end;
$$;

-- Die Artikelnamen landen in der Notiz der Ausgabe, die alle sehen
create or replace function public.finish_shopping_trip(
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
  where trip_id = trip.id and deleted_at is null and not private;

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

revoke all on function public.drop_private_shopping_items() from public, anon, authenticated;
revoke execute on function public.set_shopping_item_private(uuid, boolean) from public, anon;
grant execute on function public.set_shopping_item_private(uuid, boolean) to authenticated;
