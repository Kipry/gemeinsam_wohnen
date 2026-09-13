-- Kostenaufteilung: Ausgaben, Anteile, Rückzahlungen
-- Beträge immer in Cent (bigint), nie als float.

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'EUR',
  paid_by uuid not null references public.profiles (id),
  expense_date date not null default current_date,
  note text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.expense_shares (
  expense_id uuid not null references public.expenses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  share_cents bigint not null check (share_cents >= 0),
  primary key (expense_id, user_id)
);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  from_user uuid not null references public.profiles (id),
  to_user uuid not null references public.profiles (id),
  amount_cents bigint not null check (amount_cents > 0),
  note text,
  settled_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id),
  check (from_user <> to_user)
);

create index on public.expenses (household_id, expense_date);
create index on public.expense_shares (user_id);
create index on public.settlements (household_id);

alter table public.expenses enable row level security;
alter table public.expense_shares enable row level security;
alter table public.settlements enable row level security;

create policy "Ausgaben der eigenen WG"
  on public.expenses for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "Anteile der eigenen WG"
  on public.expense_shares for all to authenticated
  using (exists (
    select 1 from public.expenses e
    where e.id = expense_id and public.is_household_member(e.household_id)
  ))
  with check (exists (
    select 1 from public.expenses e
    where e.id = expense_id and public.is_household_member(e.household_id)
  ));

create policy "Rückzahlungen der eigenen WG"
  on public.settlements for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id) and created_by = auth.uid());

-- Ausgabe inkl. Anteilen in einem Rutsch anlegen.
-- p_shares: [{"user_id": "...", "share_cents": 1234}, ...]
create function public.create_expense(
  p_household_id uuid,
  p_title text,
  p_amount_cents bigint,
  p_paid_by uuid,
  p_shares jsonb,
  p_expense_date date default current_date,
  p_note text default null
)
returns public.expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.expenses;
  share_total bigint;
  outsiders int;
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'Keine Berechtigung';
  end if;

  if p_amount_cents <= 0 then
    raise exception 'Betrag muss größer als 0 sein';
  end if;

  select coalesce(sum((value ->> 'share_cents')::bigint), 0)
  into share_total
  from jsonb_array_elements(p_shares);

  if share_total <> p_amount_cents then
    raise exception 'Summe der Anteile (%) entspricht nicht dem Betrag (%)', share_total, p_amount_cents;
  end if;

  -- Zahler und alle Beteiligten müssen in der WG sein
  select count(*) into outsiders
  from (
    select (value ->> 'user_id')::uuid as user_id from jsonb_array_elements(p_shares)
    union
    select p_paid_by
  ) s
  where not exists (
    select 1 from public.household_members m
    where m.household_id = p_household_id and m.user_id = s.user_id
  );

  if outsiders > 0 then
    raise exception 'Beteiligte müssen Mitglieder der WG sein';
  end if;

  insert into public.expenses (
    household_id, title, amount_cents, paid_by, expense_date, note, created_by
  )
  values (
    p_household_id, trim(p_title), p_amount_cents, p_paid_by,
    coalesce(p_expense_date, current_date), nullif(trim(coalesce(p_note, '')), ''), auth.uid()
  )
  returning * into e;

  insert into public.expense_shares (expense_id, user_id, share_cents)
  select e.id, (value ->> 'user_id')::uuid, (value ->> 'share_cents')::bigint
  from jsonb_array_elements(p_shares)
  where (value ->> 'share_cents')::bigint > 0;

  return e;
end;
$$;

revoke all on function public.create_expense(uuid, text, bigint, uuid, jsonb, date, text) from public, anon;
grant execute on function public.create_expense(uuid, text, bigint, uuid, jsonb, date, text) to authenticated;

-- Saldo pro Person: positiv = bekommt Geld zurück, negativ = schuldet der WG
create view public.expense_balance_view with (security_invoker = on) as
select
  hm.household_id,
  hm.user_id,
  coalesce(paid.cents, 0)::bigint as paid_cents,
  coalesce(owed.cents, 0)::bigint as owed_cents,
  (
    coalesce(paid.cents, 0) - coalesce(owed.cents, 0)
    + coalesce(transfers.sent, 0) - coalesce(transfers.received, 0)
  )::bigint as net_cents
from public.household_members hm
left join (
  select household_id, paid_by as user_id, sum(amount_cents) as cents
  from public.expenses
  group by 1, 2
) paid on paid.household_id = hm.household_id and paid.user_id = hm.user_id
left join (
  select e.household_id, s.user_id, sum(s.share_cents) as cents
  from public.expense_shares s
  join public.expenses e on e.id = s.expense_id
  group by 1, 2
) owed on owed.household_id = hm.household_id and owed.user_id = hm.user_id
left join (
  select household_id, user_id, sum(sent) as sent, sum(received) as received
  from (
    select household_id, from_user as user_id, amount_cents as sent, 0::bigint as received
    from public.settlements
    union all
    select household_id, to_user as user_id, 0::bigint as sent, amount_cents as received
    from public.settlements
  ) t
  group by 1, 2
) transfers on transfers.household_id = hm.household_id and transfers.user_id = hm.user_id;
