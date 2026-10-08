-- The app's public address lives in one place; the database calls the app there (push dispatch right
-- after a notification, the BOCP import every 5 minutes). Calls carry the Vault secret
-- push_dispatch_secret (= the app's CRON_SECRET) and do nothing until it exists.
alter table public.app_settings add column app_url text check (app_url is null or app_url ~ '^https://[a-z0-9.-]+$');
update public.app_settings set app_url = 'https://bold-hub.vercel.app' where id = 1;
alter table public.app_settings drop column push_dispatch_url;

create or replace function private.call_app(p_path text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select app_url into v_url from public.app_settings where id = 1;
  if v_url is null then return; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_dispatch_secret' limit 1;
  if v_secret is null then return; end if;
  begin
    perform net.http_get(url := v_url || p_path, headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
      timeout_milliseconds := 60000);
  exception when others then
    null;
  end;
end
$$;
revoke all on function private.call_app(text) from public, anon, authenticated;

-- A failing push request must never undo the action that created the notification.
create or replace function private.request_push_dispatch()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  perform private.call_app('/api/push/dispatch');
  return null;
end
$$;

select cron.schedule('bocp-import', '*/5 * * * *', $$select private.call_app('/api/cron/bocp-import')$$);
