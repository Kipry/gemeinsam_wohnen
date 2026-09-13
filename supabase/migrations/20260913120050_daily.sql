-- Alltag: Einkaufsliste, Abwesenheiten, Chat

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  quantity text,
  status text not null default 'open' check (status in ('open', 'bought')),
  added_by uuid not null references public.profiles (id),
  bought_by uuid references public.profiles (id),
  bought_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.absences (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  note text,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  content text not null check (length(trim(content)) > 0),
  created_at timestamptz not null default now()
);

create index on public.shopping_items (household_id, status);
create index on public.absences (household_id, end_date);
create index on public.chat_messages (household_id, created_at);

alter table public.shopping_items enable row level security;
alter table public.absences enable row level security;
alter table public.chat_messages enable row level security;

create policy "Einkaufsliste der eigenen WG"
  on public.shopping_items for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "Abwesenheiten der eigenen WG lesen"
  on public.absences for select to authenticated
  using (public.is_household_member(household_id));

create policy "eigene Abwesenheiten pflegen"
  on public.absences for all to authenticated
  using (public.is_household_member(household_id) and user_id = auth.uid())
  with check (public.is_household_member(household_id) and user_id = auth.uid());

create policy "Chat der eigenen WG lesen"
  on public.chat_messages for select to authenticated
  using (public.is_household_member(household_id));

create policy "Chatnachricht senden"
  on public.chat_messages for insert to authenticated
  with check (public.is_household_member(household_id) and user_id = auth.uid());

create policy "eigene Chatnachricht löschen"
  on public.chat_messages for delete to authenticated
  using (user_id = auth.uid());

alter publication supabase_realtime add table public.shopping_items;
alter publication supabase_realtime add table public.chat_messages;
