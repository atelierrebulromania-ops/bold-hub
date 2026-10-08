-- A failing push request must never undo the action that created the notification.
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
  begin
    perform net.http_post(url := v_url, body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
      timeout_milliseconds := 10000);
  exception when others then
    null;
  end;
  return null;
end
$$;
