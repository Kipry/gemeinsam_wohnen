-- Geräte, die Expo als abgemeldet meldet (App gelöscht, Mitteilungen aus),
-- fliegen aus push_tokens. pg_net hält die Antworten sechs Stunden vor;
-- stündlich reicht also.

create or replace function public.prune_push_tokens()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  response record;
  dead_tokens text[] := '{}';
  removed integer;
begin
  for response in
    select content from net._http_response
    where status_code = 200 and content like '%DeviceNotRegistered%'
  loop
    begin
      if jsonb_typeof(response.content::jsonb -> 'data') = 'array' then
        dead_tokens := dead_tokens || array(
          select item -> 'details' ->> 'expoPushToken'
          from jsonb_array_elements(response.content::jsonb -> 'data') item
          where item -> 'details' ->> 'error' = 'DeviceNotRegistered'
        );
      end if;
    exception when others then
      -- Unlesbare Antwort überspringen
      null;
    end;
  end loop;

  delete from public.push_tokens where token = any (dead_tokens);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function public.prune_push_tokens() from public, anon, authenticated;

select cron.schedule('push-tokens-aufraeumen', '17 * * * *', 'select public.prune_push_tokens()');
