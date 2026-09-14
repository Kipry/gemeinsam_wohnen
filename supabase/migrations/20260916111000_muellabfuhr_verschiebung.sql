-- Verschiebungen zählen nur, wenn der ursprüngliche Tag ein echter Abholtag ist
-- (nach einer Rhythmus-Änderung könnten sonst alte Einträge Geister-Termine erzeugen).
-- Gleiche Regel wie collectionsBetween() in src/lib/waste.ts.

create or replace function public.waste_collections_on(p_household_id uuid, p_date date)
returns setof public.waste_bins
language sql
stable
security definer
set search_path = ''
as $$
  select b.*
  from public.waste_bins b
  where b.household_id = p_household_id
    and (
      (
        (p_date - b.first_date) % (7 * b.interval_weeks) = 0
        and not exists (
          select 1 from public.waste_bin_changes c
          where c.bin_id = b.id and c.original_date = p_date
        )
      )
      or exists (
        select 1 from public.waste_bin_changes c
        where c.bin_id = b.id
          and c.new_date = p_date
          and (c.original_date - b.first_date) % (7 * b.interval_weeks) = 0
      )
    )
  order by array_position(array['rest', 'papier', 'bio', 'gelb', 'sonstige'], b.kind), b.label;
$$;

revoke execute on function public.waste_collections_on(uuid, date) from public, anon, authenticated;
