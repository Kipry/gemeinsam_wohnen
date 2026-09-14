-- pg_net gehört ins Schema „extensions" (Supabase-Advisor). Die Funktionen
-- liegen weiter unter net.*, die Push-Funktionen merken davon nichts.
do $$
begin
  if exists (
    select 1 from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_net' and n.nspname = 'public'
  ) then
    drop extension pg_net;
    create extension pg_net with schema extensions;
  end if;
end $$;
