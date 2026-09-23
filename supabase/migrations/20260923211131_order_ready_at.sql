-- Record when an online order was marked ready, for the handed-orders timeline.
alter table public.online_orders add column ready_at timestamptz;

create or replace function private.mark_online_order_ready(p_order_id uuid) returns boolean
language sql security definer set search_path = ''
as $$
  with changed as (
    update public.online_orders o set status = 'ready', ready_at = now()
    where o.id = p_order_id and o.claimed_by = (select auth.uid())
      and (select auth.uid()) is not null
      and o.status in ('claimed', 'preparing')
      and (select private.current_role()) in ('admin', 'operator_depozit')
      and exists (select 1 from public.online_order_items i where i.order_id = o.id)
      and not exists (select 1 from public.online_order_items i
        where i.order_id = o.id and i.scanned_quantity < i.quantity)
    returning id
  )
  select exists (select 1 from changed)
$$;
