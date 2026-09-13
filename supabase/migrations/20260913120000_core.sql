-- Kern: Profile, WGs, Mitgliedschaften

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default upper(substr(md5(random()::text), 1, 6)),
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

create index on public.household_members (user_id);

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;

-- Profil automatisch bei Registrierung anlegen (E-Mail, Apple, ...)
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Mitbewohner:in'
    ),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Hilfsfunktionen für RLS (security definer, damit keine Rekursion in Policies entsteht)
create function public.is_household_member(h_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.household_members
    where household_id = h_id and user_id = auth.uid()
  );
$$;

create function public.is_household_owner(h_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.household_members
    where household_id = h_id and user_id = auth.uid() and role = 'owner'
  );
$$;

create function public.shares_household_with(target uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.household_members a
    join public.household_members b on a.household_id = b.household_id
    where a.user_id = auth.uid() and b.user_id = target
  );
$$;

-- Profile: nur eigenes Profil und Profile von Mitbewohnern sichtbar
create policy "profile lesbar für sich selbst und Mitbewohner"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_household_with(id));

create policy "eigenes Profil bearbeiten"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- WGs
create policy "WG lesbar für Mitglieder"
  on public.households for select to authenticated
  using (public.is_household_member(id));

create policy "WG anlegen"
  on public.households for insert to authenticated
  with check (created_by = auth.uid());

create policy "WG bearbeiten nur als Owner"
  on public.households for update to authenticated
  using (public.is_household_owner(id)) with check (public.is_household_owner(id));

-- Mitgliedschaften
create policy "Mitgliederliste lesbar für Mitglieder"
  on public.household_members for select to authenticated
  using (public.is_household_member(household_id));

-- Beitritt läuft ausschließlich über join_household_by_code(); direkt einfügen
-- darf man sich nur als Ersteller der eigenen, neuen WG.
create policy "Ersteller wird Owner"
  on public.household_members for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.households h
      where h.id = household_id and h.created_by = auth.uid()
    )
  );

create policy "selbst austreten oder als Owner entfernen"
  on public.household_members for delete to authenticated
  using (user_id = auth.uid() or public.is_household_owner(household_id));

-- WG per Einladungscode beitreten
create function public.join_household_by_code(code text)
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.households;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;

  select * into target
  from public.households
  where invite_code = upper(trim(code));

  if not found then
    raise exception 'Einladungscode nicht gefunden';
  end if;

  insert into public.household_members (household_id, user_id)
  values (target.id, auth.uid())
  on conflict do nothing;

  return target;
end;
$$;

revoke all on function public.join_household_by_code(text) from public, anon;
grant execute on function public.join_household_by_code(text) to authenticated;
