-- Marking a return "returned" in Shopify is the admin's job, not billing's.
create or replace function private.mark_return_in_shopify(p_return_id uuid)
returns boolean
language sql
security definer
set search_path to ''
as $$
  with changed as (
    update public.order_returns r set shopify_marked_manually = true
    where r.id = p_return_id and not r.shopify_marked_manually
      and (select auth.uid()) is not null
      and coalesce((select private.current_role()) = 'admin', false)
      and exists (select 1 from public.online_orders o where o.id = r.online_order_id and o.source = 'shopify')
    returning r.id
  )
  select exists (select 1 from changed)
$$;
