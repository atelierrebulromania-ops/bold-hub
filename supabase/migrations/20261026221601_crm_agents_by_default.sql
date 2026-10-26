-- Agents (account) always work the CRM, like the administrator; the per-user switch now only gives other roles
-- read access to the leads.
create or replace function private.can_view_crm() returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((select u.active and (u.role in ('admin', 'account') or u.crm_access) from public.app_users u where u.id = (select auth.uid())), false)
$$;

create or replace function private.can_work_crm() returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((select u.active and u.role in ('admin', 'account') from public.app_users u where u.id = (select auth.uid())), false)
$$;

-- New-lead and stale-lead notifications go to every active agent and the administrator.
do $$
declare
  v_fn text;
  v_def text;
begin
  foreach v_fn in array array['private.notify_crm_agents(text, uuid)', 'private.alert_stale_leads()'] loop
    v_def := pg_get_functiondef(v_fn::regprocedure);
    v_def := replace(v_def, $q$(u.role = 'admin' or (u.role = 'account' and u.crm_access))$q$, $q$u.role in ('admin', 'account')$q$);
    if position('crm_access' in v_def) > 0 then raise exception 'Unexpected definition of %', v_fn; end if;
    execute v_def;
  end loop;
end $$;
