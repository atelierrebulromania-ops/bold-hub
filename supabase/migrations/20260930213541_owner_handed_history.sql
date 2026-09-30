-- The owner sees the full history of online orders handed to the courier (customer data included),
-- like warehouse and billing: read access and the order search.
create policy owner_online_orders on public.online_orders for select
  using ((select private.current_role()) = 'owner' and status in ('handed_to_courier', 'returned'));
create policy owner_online_items on public.online_order_items for select
  using ((select private.current_role()) = 'owner'
    and exists (select 1 from public.online_orders o where o.id = online_order_items.order_id and o.status in ('handed_to_courier', 'returned')));
create policy owner_catalog on public.products for select
  using ((select private.current_role()) = 'owner');

-- Search and staff names: the same functions, with the owner added to the roles allowed.
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('private.search_online_orders(text)'::regprocedure);
  v_def := replace(v_def, $q$not in ('admin', 'operator_depozit', 'operator_facturare')$q$, $q$not in ('admin', 'owner', 'operator_depozit', 'operator_facturare')$q$);
  if position($q$'owner'$q$ in v_def) = 0 then raise exception 'search_online_orders: role check not found'; end if;
  execute v_def;

  v_def := pg_get_functiondef('private.staff_names()'::regprocedure);
  v_def := replace(v_def, $q$not in ('admin', 'operator_depozit', 'operator_facturare', 'account')$q$, $q$not in ('admin', 'owner', 'operator_depozit', 'operator_facturare', 'account')$q$);
  if position($q$'owner'$q$ in v_def) = 0 then raise exception 'staff_names: role check not found'; end if;
  execute v_def;
end $$;
