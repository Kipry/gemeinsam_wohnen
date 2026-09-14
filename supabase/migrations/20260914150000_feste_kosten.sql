-- Block D, Teil 2: Feste Kosten
--
-- Miete, Strom, Internet, Streaming sind die größten Beträge einer WG und
-- die einzige monatlich wiederkehrende Pflichtarbeit. Genau daran schläft
-- so eine App sonst im dritten Monat ein: einmal vergessen einzutragen,
-- und der Saldo stimmt nicht mehr.
--
-- Einmal anlegen, danach bucht die App die fällige Ausgabe selbst.

create table public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null,
  amount_cents bigint not null check (amount_cents > 0),
  paid_by uuid not null references public.profiles (id),
  day_of_month int not null default 1 check (day_of_month between 1 and 31),
  category text,
  split_mode text not null default 'equal'
    check (split_mode in ('equal', 'amounts', 'weights')),
  active boolean not null default true,
  last_booked_on date,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.recurring_expense_shares (
  recurring_id uuid not null references public.recurring_expenses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  share_cents bigint not null check (share_cents >= 0),
  weight numeric check (weight is null or weight > 0),
  primary key (recurring_id, user_id)
);

create index on public.recurring_expenses (household_id, active);

alter table public.recurring_expenses enable row level security;
alter table public.recurring_expense_shares enable row level security;

create policy "Feste Kosten der eigenen WG"
  on public.recurring_expenses for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "Anteile fester Kosten der eigenen WG"
  on public.recurring_expense_shares for all to authenticated
  using (exists (
    select 1 from public.recurring_expenses r
    where r.id = recurring_id and public.is_household_member(r.household_id)
  ))
  with check (exists (
    select 1 from public.recurring_expenses r
    where r.id = recurring_id and public.is_household_member(r.household_id)
  ));

-- Nächster Fälligkeitstag nach p_after. Kürzere Monate werden abgeschnitten,
-- der 31. wird im Februar also zum 28./29.
create function public.next_due_day(p_after date, p_day int)
returns date
language sql
immutable
set search_path = ''
as $$
  select min(candidate)
  from (
    select (
      month_start
      + (least(p_day, extract(day from (month_start + interval '1 month - 1 day'))::int) - 1) * interval '1 day'
    )::date as candidate
    from generate_series(
      date_trunc('month', p_after::timestamp),
      date_trunc('month', p_after::timestamp) + interval '2 month',
      interval '1 month'
    ) as month_start
  ) x
  where candidate > p_after;
$$;

create function public.create_recurring_expense(
  p_household_id uuid,
  p_title text,
  p_amount_cents bigint,
  p_paid_by uuid,
  p_shares jsonb,
  p_day_of_month int default 1,
  p_split_mode text default 'equal',
  p_category text default null
)
returns public.recurring_expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.recurring_expenses;
begin
  perform public.assert_expense_input(p_household_id, p_amount_cents, p_paid_by, p_shares);

  insert into public.recurring_expenses (
    household_id, title, amount_cents, paid_by, day_of_month, category, split_mode, created_by
  )
  values (
    p_household_id, trim(p_title), p_amount_cents, p_paid_by,
    greatest(least(coalesce(p_day_of_month, 1), 31), 1),
    nullif(trim(coalesce(p_category, '')), ''), coalesce(p_split_mode, 'equal'), auth.uid()
  )
  returning * into r;

  insert into public.recurring_expense_shares (recurring_id, user_id, share_cents, weight)
  select r.id, (value ->> 'user_id')::uuid, (value ->> 'share_cents')::bigint,
         (value ->> 'weight')::numeric
  from jsonb_array_elements(p_shares);

  return r;
end;
$$;

-- Fällige feste Kosten nachbuchen. Läuft beim Öffnen des Kosten-Tabs.
-- Verpasste Monate werden nachgeholt, aber nie vor dem Anlegen der Regel.
create function public.book_due_recurring(p_household_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.recurring_expenses;
  shares jsonb;
  due date;
  cursor_date date;
  created int := 0;
  guard int;
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'Keine Berechtigung';
  end if;

  for r in
    select * from public.recurring_expenses
    where household_id = p_household_id and active
  loop
    select jsonb_agg(jsonb_build_object(
             'user_id', user_id, 'share_cents', share_cents, 'weight', weight))
    into shares
    from public.recurring_expense_shares
    where recurring_id = r.id;

    if shares is null then
      continue;
    end if;

    cursor_date := coalesce(r.last_booked_on, (r.created_at at time zone 'UTC')::date - 1);
    guard := 0;

    loop
      guard := guard + 1;
      exit when guard > 24;

      due := public.next_due_day(cursor_date, r.day_of_month);
      exit when due is null or due > current_date;

      perform public.create_expense(
        r.household_id,
        r.title,
        r.amount_cents,
        r.paid_by,
        shares,
        r.split_mode,
        r.category,
        due,
        'Feste Kosten'
      );

      update public.recurring_expenses set last_booked_on = due where id = r.id;
      created := created + 1;
      cursor_date := due;
    end loop;
  end loop;

  return created;
end;
$$;

revoke all on function public.next_due_day(date, int) from public, anon;
revoke all on function public.create_recurring_expense(uuid, text, bigint, uuid, jsonb, int, text, text) from public, anon;
revoke all on function public.book_due_recurring(uuid) from public, anon;
grant execute on function public.create_recurring_expense(uuid, text, bigint, uuid, jsonb, int, text, text) to authenticated;
grant execute on function public.book_due_recurring(uuid) to authenticated;
