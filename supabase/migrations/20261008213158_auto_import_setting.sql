-- App-wide settings (one row). The first manual BOCP import marks the day the app starts working
-- with real orders; after it, the admin can turn on the automatic import job.
create table public.app_settings (
  id smallint primary key default 1 check (id = 1),
  launched_on date,
  launched_at timestamptz,
  launched_by uuid references public.app_users(id) on delete set null,
  auto_import boolean not null default false,
  auto_import_changed_at timestamptz,
  auto_import_changed_by uuid references public.app_users(id) on delete set null,
  last_auto_import_at timestamptz,
  last_auto_import jsonb
);
insert into public.app_settings default values;
alter table public.app_settings enable row level security;
create policy admin_read on public.app_settings for select to authenticated
  using ((select private.current_role()) = 'admin');

-- Admin: a manual import ran from p_from (the first one sets the launch day).
create or replace function private.record_manual_import(p_from date)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if (select auth.uid()) is null or coalesce((select private.current_role()) <> 'admin', true) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  update public.app_settings set launched_on = coalesce(launched_on, p_from), launched_at = coalesce(launched_at, now()),
    launched_by = coalesce(launched_by, (select auth.uid()))
  where id = 1;
end
$$;

-- Admin turns the automatic import on or off; on only after the first manual import.
create or replace function private.set_auto_import(p_on boolean)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if (select auth.uid()) is null or coalesce((select private.current_role()) <> 'admin', true) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if coalesce(p_on, false) and (select launched_on from public.app_settings where id = 1) is null then
    raise exception 'Run the first import manually' using errcode = '55000';
  end if;
  update public.app_settings set auto_import = coalesce(p_on, false), auto_import_changed_at = now(),
    auto_import_changed_by = (select auth.uid()) where id = 1;
  return coalesce(p_on, false);
end
$$;

-- The scheduled job (service role) records how its last run went.
create or replace function private.record_auto_import(p_result jsonb)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service access required' using errcode = '42501';
  end if;
  update public.app_settings set last_auto_import_at = now(), last_auto_import = p_result where id = 1;
end
$$;

-- The import itself: the admin (manual) or the scheduled job (service role).
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'import_bocp_online_orders';
  if position($g$if (select auth.uid()) is null or (select private.current_role()) <> 'admin' then$g$ in v_def) = 0 then
    raise exception 'import guard changed';
  end if;
  v_def := replace(v_def, $g$if (select auth.uid()) is null or (select private.current_role()) <> 'admin' then$g$,
    $g$if not ((select auth.role()) = 'service_role' or ((select auth.uid()) is not null and (select private.current_role()) = 'admin')) then$g$);
  execute v_def;
end
$$;

create or replace function public.import_bocp_online_orders_job(p_orders jsonb) returns jsonb language sql security invoker set search_path to ''
as $$ select private.import_bocp_online_orders(p_orders) $$;
create or replace function public.record_manual_import(p_from date) returns void language sql security invoker set search_path to ''
as $$ select private.record_manual_import(p_from) $$;
create or replace function public.set_auto_import(p_on boolean) returns boolean language sql security invoker set search_path to ''
as $$ select private.set_auto_import(p_on) $$;
create or replace function public.record_auto_import(p_result jsonb) returns void language sql security invoker set search_path to ''
as $$ select private.record_auto_import(p_result) $$;

revoke all on function private.record_manual_import(date), private.set_auto_import(boolean), private.record_auto_import(jsonb),
  public.record_manual_import(date), public.set_auto_import(boolean), public.record_auto_import(jsonb),
  public.import_bocp_online_orders_job(jsonb) from public, anon, authenticated;
grant execute on function private.record_manual_import(date), private.set_auto_import(boolean),
  public.record_manual_import(date), public.set_auto_import(boolean) to authenticated;
grant execute on function private.record_auto_import(jsonb), public.record_auto_import(jsonb),
  private.import_bocp_online_orders(jsonb), public.import_bocp_online_orders_job(jsonb) to service_role;
grant select on public.app_settings to authenticated;
