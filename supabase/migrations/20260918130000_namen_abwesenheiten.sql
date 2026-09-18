-- Anzeigenamen selbst ändern; doppelt gespeicherte Abwesenheiten verhindern

-- Profile: Direkt aus der App ist nur noch der eigene Name änderbar — nicht etwa
-- deleted_at, das ein Profil als „Ehemaliges Mitglied" erscheinen lässt.
revoke update on public.profiles from anon, authenticated;
grant update (full_name) on public.profiles to authenticated;

-- Keine leeren oder seitenlangen Namen. Bestehende Zeilen bleiben ungeprüft;
-- die App begrenzt auf 40 Zeichen, E-Mail-Präfixe beim Registrieren auf 64.
alter table public.profiles
  add constraint profiles_full_name_sane
  check (btrim(full_name) <> '' and char_length(full_name) <= 100) not valid;

-- Die Schnellwahl „Ich bin weg" speichert beim ersten Tipp. Ein Doppeltipp oder
-- eine nach Zeitüberschreitung wiederholte Anfrage legte dieselbe Abwesenheit
-- zweimal an — samt doppelter Chat-Meldung und Mitteilung. Gibt es genau diesen
-- Zeitraum für die Person schon, wird der zweite Eintrag still verworfen.
create function public.skip_duplicate_absence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Zwei gleichzeitige Anfragen derselben Person nacheinander prüfen
  perform pg_advisory_xact_lock(
    hashtextextended('absence:' || new.household_id::text || ':' || new.user_id::text, 0)
  );

  if exists (
    select 1 from public.absences a
    where a.household_id = new.household_id
      and a.user_id = new.user_id
      and a.start_date = new.start_date
      and a.end_date = new.end_date
  ) then
    return null;
  end if;

  return new;
end;
$$;

create trigger skip_duplicate_absence
  before insert on public.absences
  for each row execute function public.skip_duplicate_absence();
