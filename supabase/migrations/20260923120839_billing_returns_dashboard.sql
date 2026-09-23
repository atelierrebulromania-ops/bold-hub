-- Billing, returns, order investigation, and the read-only owner dashboard.
-- Every write goes through a role-checked RPC; the owner reads aggregates only.

-- One return per online order, plus who confirmed the physical check.
alter table public.order_returns
  add column restocked_by uuid references public.app_users(id),
  add column restocked_at timestamptz,
  add constraint order_return_restock_state check ((status = 'restocked') = (restocked_at is not null)),
  add constraint order_return_unique_order unique (online_order_id);
create index order_returns_restocked_by_idx on public.order_returns(restocked_by);
create index order_returns_pending_idx on public.order_returns(registered_at desc) where status = 'pending_restock';

-- Returns change order status and require a physical check, so direct writes are closed.
drop policy billing_insert_return on public.order_returns;
drop policy billing_update_return on public.order_returns;
revoke insert, update, delete on public.order_returns from authenticated;

create function private.search_online_orders(p_query text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_query text := trim(coalesce(p_query, ''));
  v_pattern text;
  v_digits text;
begin
  if (select auth.uid()) is null or coalesce(
    (select private.current_role()) not in ('admin', 'operator_depozit', 'operator_facturare'), true) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if length(v_query) < 3 or length(v_query) > 120 then return '[]'::jsonb; end if;
  v_pattern := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  -- Phone numbers are compared by digits, ignoring the 0 / 40 national prefix.
  v_digits := regexp_replace(regexp_replace(v_query, '\D', '', 'g'), '^(40|0)', '');

  return coalesce((
    select jsonb_agg(m.row_data order by m.created_at desc) from (
      select o.created_at, jsonb_build_object(
        'id', o.id, 'invoice_number', o.invoice_number, 'bocp_order_id', o.bocp_order_id,
        'source', o.source, 'status', o.status, 'customer_name', o.customer_name,
        'customer_email', o.customer_email, 'customer_phone', o.customer_phone,
        'shipping_address', o.shipping_address, 'created_at', o.created_at,
        'claimed_at', o.claimed_at, 'released_at', o.released_at, 'completed_at', o.completed_at,
        'claimed_by_name', u.full_name,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object('name', p.name, 'sku', p.sku, 'variant_label', p.variant_label,
            'quantity', i.quantity, 'scanned_quantity', i.scanned_quantity) order by i.created_at, i.id)
          from public.online_order_items i join public.products p on p.id = i.product_id
          where i.order_id = o.id), '[]'::jsonb),
        'return', (
          select jsonb_build_object('id', r.id, 'reason', r.reason, 'status', r.status,
            'registered_at', r.registered_at, 'restocked_at', r.restocked_at,
            'shopify_marked_manually', r.shopify_marked_manually)
          from public.order_returns r where r.online_order_id = o.id)
      ) as row_data
      from public.online_orders o
      left join public.app_users u on u.id = o.claimed_by
      where o.invoice_number ilike v_pattern
        or o.bocp_order_id ilike v_pattern
        or o.customer_name ilike v_pattern
        or o.customer_email ilike v_pattern
        or (length(v_digits) >= 6
          and regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g') like '%' || v_digits || '%')
      order by o.created_at desc
      limit 50
    ) m
  ), '[]'::jsonb);
end
$$;

create function private.register_order_return(
  p_order_id uuid, p_reason public.return_reason, p_shopify_marked boolean
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_invoice text;
  v_return_id uuid;
begin
  if (select auth.uid()) is null or coalesce(
    (select private.current_role()) not in ('admin', 'operator_facturare'), true) then
    return false;
  end if;
  select invoice_number into v_invoice from public.online_orders
    where id = p_order_id and status = 'handed_to_courier' for update;
  if not found then return false; end if;

  insert into public.order_returns (online_order_id, reason, registered_by, shopify_marked_manually)
    values (p_order_id, coalesce(p_reason, 'neridicat'), (select auth.uid()), coalesce(p_shopify_marked, false))
    returning id into v_return_id;
  update public.online_orders set status = 'returned' where id = p_order_id;
  insert into public.notifications (recipient_role, type, message, related_entity_type, related_entity_id) values
    ('admin', 'retur_inregistrat', 'Retur înregistrat pentru factura ' || v_invoice || '.', 'order_return', v_return_id),
    ('operator_depozit', 'retur_de_verificat', 'Retur de verificat fizic: factura ' || v_invoice || '.', 'order_return', v_return_id);
  return true;
end
$$;

-- BOCP stays the source of truth for stock; this only records the physical check.
create function private.confirm_return_restock(p_return_id uuid) returns boolean
language sql security definer set search_path = ''
as $$
  with changed as (
    update public.order_returns
    set status = 'restocked', restocked_by = (select auth.uid()), restocked_at = now()
    where id = p_return_id and status = 'pending_restock'
      and (select auth.uid()) is not null
      and coalesce((select private.current_role()) in ('admin', 'operator_depozit'), false)
    returning id
  )
  select exists (select 1 from changed)
$$;

create function private.mark_return_in_shopify(p_return_id uuid) returns boolean
language sql security definer set search_path = ''
as $$
  with changed as (
    update public.order_returns r set shopify_marked_manually = true
    where r.id = p_return_id and not r.shopify_marked_manually
      and (select auth.uid()) is not null
      and coalesce((select private.current_role()) in ('admin', 'operator_facturare'), false)
      and exists (select 1 from public.online_orders o where o.id = r.online_order_id and o.source = 'shopify')
    returning r.id
  )
  select exists (select 1 from changed)
$$;

create function private.mark_fulfillment_invoiced(p_fulfillment_id uuid, p_invoice_number text) returns boolean
language sql security definer set search_path = ''
as $$
  with changed as (
    update public.reseller_order_fulfillments
    set status = 'invoiced', invoiced_by = (select auth.uid()), invoiced_at = now(),
      invoice_number = trim(p_invoice_number)
    where id = p_fulfillment_id and status = 'ready_to_deliver'
      and length(trim(coalesce(p_invoice_number, ''))) between 1 and 60
      and (select auth.uid()) is not null
      and coalesce((select private.current_role()) in ('admin', 'operator_facturare'), false)
    returning id
  )
  select exists (select 1 from changed)
$$;

-- Aggregates only: the owner never gets row-level access to customer data.
create function private.dashboard_summary(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = ''
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
      'open_carts', (select count(*) from public.reseller_carts where status = 'open'),
      'overdue_carts', (select count(*) from public.reseller_carts
        where status = 'open' and countdown_started_at < now() - interval '48 hours'),
      'pending_deliveries', (select count(*) from public.deliveries where status = 'pending_confirmation'),
      'awaiting_invoice', (select count(*) from public.reseller_order_fulfillments where status = 'ready_to_deliver'),
      'fulfillments_delivered', (select count(*) from public.reseller_order_fulfillments
        where delivered_at >= p_from and delivered_at < p_to),
      'top_resellers', coalesce((
        select jsonb_agg(jsonb_build_object('name', r.business_name, 'location', r.location_name,
          'units', t.units) order by t.units desc)
        from (
          select c.reseller_id, sum(i.quantity_needed) as units
          from public.reseller_cart_items i join public.reseller_carts c on c.id = i.cart_id
          where i.created_at >= p_from and i.created_at < p_to
          group by c.reseller_id order by units desc limit 5
        ) t join public.resellers r on r.id = t.reseller_id), '[]'::jsonb)
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

revoke all on function private.search_online_orders(text) from public, anon;
revoke all on function private.register_order_return(uuid, public.return_reason, boolean) from public, anon;
revoke all on function private.confirm_return_restock(uuid) from public, anon;
revoke all on function private.mark_return_in_shopify(uuid) from public, anon;
revoke all on function private.mark_fulfillment_invoiced(uuid, text) from public, anon;
revoke all on function private.dashboard_summary(timestamptz, timestamptz) from public, anon;
grant execute on function private.search_online_orders(text) to authenticated;
grant execute on function private.register_order_return(uuid, public.return_reason, boolean) to authenticated;
grant execute on function private.confirm_return_restock(uuid) to authenticated;
grant execute on function private.mark_return_in_shopify(uuid) to authenticated;
grant execute on function private.mark_fulfillment_invoiced(uuid, text) to authenticated;
grant execute on function private.dashboard_summary(timestamptz, timestamptz) to authenticated;

create function public.search_online_orders(p_query text) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select private.search_online_orders(p_query) $$;
create function public.register_order_return(p_order_id uuid, p_reason public.return_reason, p_shopify_marked boolean)
returns boolean language sql security invoker set search_path = ''
as $$ select private.register_order_return(p_order_id, p_reason, p_shopify_marked) $$;
create function public.confirm_return_restock(p_return_id uuid) returns boolean
language sql security invoker set search_path = ''
as $$ select private.confirm_return_restock(p_return_id) $$;
create function public.mark_return_in_shopify(p_return_id uuid) returns boolean
language sql security invoker set search_path = ''
as $$ select private.mark_return_in_shopify(p_return_id) $$;
create function public.mark_fulfillment_invoiced(p_fulfillment_id uuid, p_invoice_number text) returns boolean
language sql security invoker set search_path = ''
as $$ select private.mark_fulfillment_invoiced(p_fulfillment_id, p_invoice_number) $$;
create function public.dashboard_summary(p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select private.dashboard_summary(p_from, p_to) $$;
