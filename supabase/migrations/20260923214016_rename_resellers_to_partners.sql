-- Resellers become partners everywhere: tables, columns, enum, functions, policies,
-- constraints and indexes. Partners have a type: reseller, horeca or altul.

-- Functions whose definition mentions resellers are recreated from their current
-- definitions with every "reseller" renamed, keeping their execute grants.
create temp table renamed_functions on commit drop as
  select p.oid, pg_get_functiondef(p.oid) as def, p.proacl,
    format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as signature
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prokind = 'f' and pg_get_functiondef(p.oid) ~ 'reseller';

alter table public.resellers rename to partners;
alter table public.reseller_companies rename to partner_companies;
alter table public.reseller_delivery_groups rename to partner_delivery_groups;
alter table public.reseller_par_levels rename to partner_par_levels;
alter table public.reseller_carts rename to partner_carts;
alter table public.reseller_cart_items rename to partner_cart_items;
alter table public.reseller_order_fulfillments rename to partner_order_fulfillments;

alter table public.partner_delivery_groups rename column reseller_id to partner_id;
alter table public.partner_par_levels rename column reseller_id to partner_id;
alter table public.partner_carts rename column reseller_id to partner_id;
alter table public.refill_requests rename column reseller_id to partner_id;
alter table public.deliveries rename column triggered_by_reseller_id to triggered_by_partner_id;

alter type public.reseller_order_status rename to partner_order_status;

alter table public.partners drop constraint resellers_partner_type_check;
alter table public.partners rename column partner_type to type;
update public.partners set type = 'reseller' where type = 'revanzator';
alter table public.partners alter column type set default 'reseller';
alter table public.partners add constraint partners_type_check check (type in ('reseller', 'horeca', 'altul'));

update public.notifications set related_entity_type = replace(related_entity_type, 'reseller', 'partner')
  where related_entity_type like '%reseller%';

do $$
declare r record; a record;
begin
  for r in select * from pg_policies where policyname ~ 'reseller' loop
    execute format('alter policy %I on %I.%I rename to %I', r.policyname, r.schemaname, r.tablename,
      replace(r.policyname, 'reseller', 'partner'));
  end loop;
  for r in select c.conname, t.relname from pg_constraint c join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace where n.nspname = 'public' and c.conname ~ 'reseller' loop
    execute format('alter table public.%I rename constraint %I to %I', r.relname, r.conname,
      replace(r.conname, 'reseller', 'partner'));
  end loop;
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'i' and c.relname ~ 'reseller' loop
    execute format('alter index public.%I rename to %I', r.relname, replace(r.relname, 'reseller', 'partner'));
  end loop;

  for r in select * from renamed_functions loop
    execute 'drop function ' || r.signature;
  end loop;
  perform set_config('check_function_bodies', 'off', true);
  for r in select * from renamed_functions loop
    execute replace(r.def, 'reseller', 'partner');
  end loop;
  -- Restore execute grants on the recreated functions (new functions default to PUBLIC).
  for r in select f.*, (regexp_match(replace(f.def, 'reseller', 'partner'), 'FUNCTION ([a-z_]+\.[a-z_"]+)\('))[1] as name,
      replace(regexp_replace(f.signature, '^[a-z_]+\.[a-z_]+', ''), 'reseller', 'partner') as args
      from renamed_functions f loop
    execute format('revoke all on function %s%s from public, anon, authenticated', r.name, r.args);
    for a in select coalesce(g.rolname, 'public') as grantee from aclexplode(coalesce(r.proacl, acldefault('f', 10))) e
        left join pg_roles g on g.oid = e.grantee where e.privilege_type = 'EXECUTE' and coalesce(g.rolname, '') <> 'postgres' loop
      execute format('grant execute on function %s%s to %s', r.name, r.args, a.grantee);
    end loop;
  end loop;
end $$;
