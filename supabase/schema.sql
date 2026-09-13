-- Gemeinsam Wohnen — Supabase Schema
-- Run in Supabase SQL editor (or via `supabase db push`).

-- ───────────────────────────────────────────── profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are readable by authenticated users"
  on public.profiles for select to authenticated using (true);

create policy "users manage their own profile"
  on public.profiles for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- auto-create a profile row when a user signs up
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ───────────────────────────────────────────── households
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default substr(md5(random()::text), 1, 6),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

alter table public.households enable row level security;
alter table public.household_members enable row level security;

create function public.is_household_member(h_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.household_members
    where household_id = h_id and user_id = auth.uid()
  );
$$ language sql security definer stable;

create policy "members can read their household"
  on public.households for select to authenticated
  using (public.is_household_member(id));

create policy "any authenticated user can create a household"
  on public.households for insert to authenticated
  with check (created_by = auth.uid());

create policy "members can read membership rows of their household"
  on public.household_members for select to authenticated
  using (public.is_household_member(household_id));

create policy "users can join a household (insert own row)"
  on public.household_members for insert to authenticated
  with check (user_id = auth.uid());

create policy "users can leave a household (delete own row)"
  on public.household_members for delete to authenticated
  using (user_id = auth.uid());

-- ───────────────────────────────────────────── tasks (Putzplan)
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null,
  description text,
  points int not null default 1,
  interval_days int not null default 7,
  active boolean not null default true,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.task_occurrences (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  due_date date not null,
  assigned_to uuid references public.profiles (id),
  status text not null default 'open' check (status in ('open', 'done')),
  completed_by uuid references public.profiles (id),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.tasks enable row level security;
alter table public.task_occurrences enable row level security;

create policy "members manage tasks of their household"
  on public.tasks for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "members manage task occurrences of their household"
  on public.task_occurrences for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- ───────────────────────────────────────────── shopping list
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

alter table public.shopping_items enable row level security;

create policy "members manage shopping items of their household"
  on public.shopping_items for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- ───────────────────────────────────────────── absences
create table public.absences (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  start_date date not null,
  end_date date not null,
  note text,
  created_at timestamptz not null default now()
);

alter table public.absences enable row level security;

create policy "members manage absences of their household"
  on public.absences for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- ───────────────────────────────────────────── chat
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.chat_messages enable row level security;

create policy "members read chat of their household"
  on public.chat_messages for select to authenticated
  using (public.is_household_member(household_id));

create policy "members send chat messages to their household"
  on public.chat_messages for insert to authenticated
  with check (public.is_household_member(household_id) and user_id = auth.uid());

-- realtime for chat + task occurrences + shopping list
alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.task_occurrences;
alter publication supabase_realtime add table public.shopping_items;

-- ───────────────────────────────────────────── balance view
-- points completed per member, per household, all-time
create view public.balance_view as
select
  o.household_id,
  o.completed_by as user_id,
  p.full_name,
  count(*) as tasks_done,
  sum(t.points) as points_done
from public.task_occurrences o
join public.tasks t on t.id = o.task_id
join public.profiles p on p.id = o.completed_by
where o.status = 'done' and o.completed_by is not null
group by o.household_id, o.completed_by, p.full_name;
