-- Remove the old refill-delivery flow (deliveries → confirm → invoice → driver). B2B carts now go
-- "Produsele rezervate pe raft" → "Predare - Facturare" → "Facturat" on the cart itself.
drop function public.create_manual_delivery(uuid[], uuid);
drop function private.create_manual_delivery(uuid[], uuid);
drop function public.confirm_delivery_ready(uuid);
drop function private.confirm_delivery_ready(uuid);
drop function public.hand_delivery_to_driver(uuid);
drop function private.hand_delivery_to_driver(uuid);
drop function public.cancel_delivery(uuid);
drop function private.cancel_delivery(uuid);
drop function public.release_cart_from_delivery(uuid, uuid);
drop function private.release_cart_from_delivery(uuid, uuid);
drop function public.mark_fulfillment_invoiced(uuid, text);
drop function private.mark_fulfillment_invoiced(uuid, text);
drop function private.propose_delivery(uuid[], public.delivery_trigger_type, uuid, uuid);

create or replace function private.delete_delivery_group(p_group_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not private.is_staff(array['admin', 'operator_depozit']::public.user_role[]) then return false; end if;
  delete from public.delivery_groups where id = p_group_id;
  return found;
end
$$;

drop table public.partner_order_fulfillments;
drop table public.delivery_carts;
drop table public.deliveries;
drop type public.delivery_status;
drop type public.delivery_trigger_type;

-- Dashboard: the B2B figures now come from the carts.
create or replace function private.dashboard_summary(p_from timestamp with time zone, p_to timestamp with time zone)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $$
declare v_result jsonb;
begin
  if (select auth.uid()) is null or coalesce(
    (select private.current_role()) not in ('admin', 'owner'), true) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '370 days' then
    raise exception 'Invalid range' using errcode = '22023';
  end if;

  with handed as (
    select o.* from public.online_orders o
    where o.completed_at >= p_from and o.completed_at < p_to
      and o.status in ('handed_to_courier', 'returned')
  ),
  created as (
    select o.created_at from public.online_orders o
    where o.created_at >= p_from and o.created_at < p_to
  ),
  returns_in_range as (
    select r.reason from public.order_returns r
    where r.registered_at >= p_from and r.registered_at < p_to
  )
  select jsonb_build_object(
    'online', jsonb_build_object(
      'created', (select count(*) from created),
      'handed', (select count(*) from handed),
      'handed_shopify', (select count(*) from handed where source = 'shopify'),
      'handed_marketplace', (select count(*) from handed where source = 'marketplace'),
      'open_now', (select count(*) from public.online_orders
        where status in ('pending', 'claimed', 'preparing', 'ready')),
      'waiting_now', (select count(*) from public.online_orders where status = 'pending'),
      'avg_prep_minutes', (select round(avg(extract(epoch from completed_at - claimed_at)) / 60)
        from handed where claimed_at is not null),
      'avg_total_hours', (select round(avg(extract(epoch from completed_at - created_at)) / 3600, 1)
        from handed)
    ),
    'operators', coalesce((
      select jsonb_agg(jsonb_build_object('name', coalesce(u.full_name, '—'), 'handed', t.n) order by t.n desc)
      from (select claimed_by, count(*) as n from handed group by claimed_by) t
      left join public.app_users u on u.id = t.claimed_by), '[]'::jsonb),
    'returns', jsonb_build_object(
      'registered', (select count(*) from returns_in_range),
      'pending_restock_now', (select count(*) from public.order_returns where status = 'pending_restock'),
      'by_reason', coalesce((select jsonb_object_agg(x.reason, x.n)
        from (select reason, count(*) as n from returns_in_range group by reason) x), '{}'::jsonb)
    ),
    'refill', jsonb_build_object(
      'open_carts', (select count(*) from public.partner_carts where status = 'open'),
      'overdue_carts', (select count(*) from public.partner_carts
        where status = 'open' and countdown_started_at < now() - interval '48 hours'),
      'awaiting_invoice', (select count(*) from public.partner_carts
        where status = 'delivered' and invoiced_at is null),
      'invoiced', (select count(*) from public.partner_carts
        where invoiced_at >= p_from and invoiced_at < p_to),
      'top_partners', coalesce((
        select jsonb_agg(jsonb_build_object('name', r.business_name, 'location', r.location_name,
          'units', t.units) order by t.units desc)
        from (
          select c.partner_id, sum(i.quantity_needed) as units
          from public.partner_cart_items i join public.partner_carts c on c.id = i.cart_id
          where i.created_at >= p_from and i.created_at < p_to
          group by c.partner_id order by units desc limit 5
        ) t join public.partners r on r.id = t.partner_id), '[]'::jsonb)
    ),
    'stock', jsonb_build_object(
      'tracked_products', (select count(*) from public.warehouse_stock),
      'bocp_units', (select coalesce(sum(quantity_bocp_global), 0) from public.warehouse_stock),
      'reserved_units', (select coalesce(sum(quantity_reserved), 0) from public.warehouse_stock),
      'over_reserved_products', (select count(*) from public.warehouse_stock
        where quantity_reserved > quantity_bocp_global),
      'last_sync', (select max(updated_at) from public.warehouse_stock)
    ),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'created', d.created, 'handed', d.handed) order by d.day)
      from (
        select g.day::date as day,
          (select count(*) from created c
            where (c.created_at at time zone 'Europe/Bucharest')::date = g.day::date) as created,
          (select count(*) from handed h
            where (h.completed_at at time zone 'Europe/Bucharest')::date = g.day::date) as handed
        from generate_series(
          (p_from at time zone 'Europe/Bucharest')::date,
          ((p_to - interval '1 microsecond') at time zone 'Europe/Bucharest')::date,
          interval '1 day') g(day)
      ) d), '[]'::jsonb)
  ) into v_result;
  return v_result;
end
$$;
