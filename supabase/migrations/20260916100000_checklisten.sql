-- Checklisten für Routinen
--
-- Einmal festlegen, was zu „Bad putzen" gehört, und beim Putzen abhaken.
-- Der Fortschritt hängt an Aufgabe + Fälligkeitstag statt an der Termin-ID:
-- update_task und das Umplanen bei Abwesenheit legen offene Termine neu an,
-- die Haken sollen das überleben.

create table if not exists public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  position int not null default 0,
  label text not null check (length(trim(label)) between 1 and 120),
  created_at timestamptz not null default now()
);

create index if not exists task_checklist_items_task_idx
  on public.task_checklist_items (task_id, position);

create table if not exists public.task_checklist_checks (
  task_id uuid not null references public.tasks (id) on delete cascade,
  due_date date not null,
  item_id uuid not null references public.task_checklist_items (id) on delete cascade,
  checked_by uuid references public.profiles (id) on delete set null,
  checked_at timestamptz not null default now(),
  primary key (task_id, due_date, item_id)
);

alter table public.task_checklist_items enable row level security;
alter table public.task_checklist_checks enable row level security;

create policy "Checklisten der eigenen WG lesen" on public.task_checklist_items
  for select using (
    exists (select 1 from public.tasks t where t.id = task_id and public.is_household_member(t.household_id))
  );

create policy "Haken der eigenen WG lesen" on public.task_checklist_checks
  for select using (
    exists (select 1 from public.tasks t where t.id = task_id and public.is_household_member(t.household_id))
  );

create policy "selbst abhaken" on public.task_checklist_checks
  for insert with check (
    checked_by = auth.uid()
    and exists (
      select 1
      from public.task_checklist_items i
      join public.tasks t on t.id = i.task_id
      where i.id = item_id
        and i.task_id = task_checklist_checks.task_id
        and public.is_household_member(t.household_id)
    )
  );

-- Haken wieder entfernen darf jede Person der WG — man putzt ja oft zu zweit
create policy "Haken entfernen" on public.task_checklist_checks
  for delete using (
    exists (select 1 from public.tasks t where t.id = task_id and public.is_household_member(t.household_id))
  );

-- Speichert die Checkliste in der übergebenen Reihenfolge. Einträge mit id
-- bleiben erhalten (samt Haken), fehlende werden gelöscht, neue angelegt.
create or replace function public.save_task_checklist(p_task_id uuid, p_items jsonb)
returns setof public.task_checklist_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
  keep_ids uuid[];
begin
  select * into t from public.tasks where id = p_task_id;
  if not found then
    raise exception 'Aufgabe nicht gefunden';
  end if;

  if not public.is_household_member(t.household_id) then
    raise exception 'Keine Berechtigung';
  end if;

  select coalesce(array_agg((elem ->> 'id')::uuid) filter (
           where elem ->> 'id' is not null and length(trim(coalesce(elem ->> 'label', ''))) > 0
         ), '{}')
  into keep_ids
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) elem;

  delete from public.task_checklist_items
  where task_id = t.id and not (id = any (keep_ids));

  insert into public.task_checklist_items (id, task_id, position, label)
  select coalesce((elem ->> 'id')::uuid, gen_random_uuid()), t.id, (ord - 1)::int, trim(elem ->> 'label')
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as e(elem, ord)
  where length(trim(coalesce(elem ->> 'label', ''))) > 0
  on conflict (id) do update
  set position = excluded.position, label = excluded.label
  -- nie Einträge einer fremden Aufgabe umschreiben
  where public.task_checklist_items.task_id = excluded.task_id;

  return query
  select * from public.task_checklist_items where task_id = t.id order by position;
end;
$$;

revoke execute on function public.save_task_checklist(uuid, jsonb) from public, anon;
grant execute on function public.save_task_checklist(uuid, jsonb) to authenticated;

alter publication supabase_realtime add table public.task_checklist_checks;
