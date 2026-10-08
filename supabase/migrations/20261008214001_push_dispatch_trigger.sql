-- Right after a staff notification is created, the database asks the app to push it. Inactive until
-- the deploy sets app_settings.push_dispatch_url and a vault secret named push_dispatch_secret
-- (the app's CRON_SECRET).
create extension if not exists pg_net with schema extensions;

alter table public.app_settings add column push_dispatch_url text
  check (push_dispatch_url is null or push_dispatch_url ~ '^https://[^\s]+/api/push/dispatch$');

create or replace function private.request_push_dispatch()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select push_dispatch_url into v_url from public.app_settings where id = 1;
  if v_url is null then return null; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_dispatch_secret' limit 1;
  if v_secret is null then return null; end if;
  perform net.http_post(url := v_url, body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 10000);
  return null;
end
$$;
revoke all on function private.request_push_dispatch() from public, anon, authenticated;

create trigger notifications_push_dispatch
  after insert on public.notifications
  for each statement execute function private.request_push_dispatch();
