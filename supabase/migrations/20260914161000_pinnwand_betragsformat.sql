-- to_char() nutzt die Locale-Trennzeichen der Datenbank (C: Punkt als
-- Dezimal-, Komma als Tausendertrennzeichen). In der Ereigniskarte stand
-- dadurch "32.00 €" statt "32,00 €". translate() dreht beide Zeichen um,
-- damit aus 1,234.56 ein 1.234,56 wird.
create or replace function public.on_expense_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.post_chat_event(
    new.household_id, new.created_by,
    format('hat „%s" über %s € eingetragen',
           new.title,
           translate(to_char(new.amount_cents / 100.0, 'FM999G999D00'), '.,', ',.')),
    'expenses', new.id
  );
  return new;
end;
$$;
