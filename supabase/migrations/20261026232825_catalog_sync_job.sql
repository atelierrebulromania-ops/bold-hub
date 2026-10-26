-- The BOCP catalog and stock sync also runs as a scheduled job (server key), not only from Admin → Catalog.
alter table public.app_settings add column if not exists catalog_synced_at timestamptz;

do $$
declare
  v_def text := pg_get_functiondef('private.sync_bocp_catalog(jsonb)'::regprocedure);
  v_old text := $q$if (select auth.uid()) is null or coalesce((select private.current_role()) <> 'admin', true) then$q$;
begin
  if position(v_old in v_def) = 0 then raise exception 'Unexpected definition of private.sync_bocp_catalog'; end if;
  v_def := replace(v_def, v_old,
    $q$if coalesce((select auth.role()), '') <> 'service_role' and ((select auth.uid()) is null or coalesce((select private.current_role()) <> 'admin', true)) then$q$);
  execute v_def;
end $$;

select cron.schedule('catalog-sync', '*/15 * * * *', $$select private.call_app('/api/cron/catalog-sync')$$);
