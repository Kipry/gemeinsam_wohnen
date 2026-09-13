-- WG anlegen muss atomar passieren: ohne Mitgliedschaftszeile kann der Ersteller
-- die gerade angelegte WG nicht einmal zurücklesen (SELECT-Policy greift), und
-- eine WG ohne Mitglieder wäre für niemanden mehr erreichbar.

create function public.create_household(name text)
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare
  created public.households;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;

  if length(trim(coalesce(name, ''))) = 0 then
    raise exception 'Bitte einen Namen für die WG angeben';
  end if;

  insert into public.households (name, created_by)
  values (trim(name), auth.uid())
  returning * into created;

  insert into public.household_members (household_id, user_id, role)
  values (created.id, auth.uid(), 'owner');

  return created;
end;
$$;

revoke all on function public.create_household(text) from public, anon;
grant execute on function public.create_household(text) to authenticated;

-- Mitgliedschaften entstehen ab jetzt ausschließlich über create_household()
-- und join_household_by_code().
drop policy "Ersteller wird Owner" on public.household_members;
drop policy "WG anlegen" on public.households;
