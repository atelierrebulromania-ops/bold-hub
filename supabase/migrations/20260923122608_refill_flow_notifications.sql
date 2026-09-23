-- Flow 1 (refill): carts, stock reservation, the three delivery triggers, the reverse
-- flow to billing, reseller app accounts, and in-app notifications.
-- Every write goes through a role-checked RPC; tables keep read-only RLS for staff/resellers.

-- One open cart per reseller; a cart in a delivery is closed to new items.
create unique index reseller_carts_one_open_idx on public.reseller_carts(reseller_id) where status = 'open';
create unique index resellers_auth_user_idx on public.resellers(auth_user_id) where auth_user_id is not null;
create index deliveries_pending_group_idx on public.deliveries(delivery_group_id) where status = 'pending_confirmation';
create index notifications_unread_idx on public.notifications(created_at desc) where read_at is null;

-- Operators also record requests that arrive by phone.
alter table public.refill_requests drop constraint refill_requests_source_check;
alter table public.refill_requests add constraint refill_requests_source_check
  check (source in ('whatsapp', 'app', 'telefon'));

-- ---------- internal helpers (no grants: callable only from the guarded RPCs below) ----------

create function private.notify(p_role public.user_role, p_type text, p_message text, p_entity_type text, p_entity_id uuid)
returns void language sql security definer set search_path = ''
as $$
  insert into public.notifications (recipient_role, type, message, related_entity_type, related_entity_id)
  values (p_role, p_type, p_message, p_entity_type, p_entity_id)
$$;

-- The delivery group a reseller is routed with: its first group by name, if any.
create function private.reseller_group(p_reseller_id uuid) returns uuid
language sql stable security definer set search_path = ''
as $$
  select g.id from public.reseller_delivery_groups rg
  join public.delivery_groups g on g.id = rg.delivery_group_id
  where rg.reseller_id = p_reseller_id
  order by g.name, g.id limit 1
$$;

-- Puts open carts into a delivery waiting for operator confirmation. Reuses the pending
-- delivery of the same group so a route is never split into two proposals.
create function private.propose_delivery(
  p_cart_ids uuid[], p_trigger public.delivery_trigger_type, p_group uuid, p_triggered_by uuid
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_delivery_id uuid;
  v_carts uuid[];
begin
  select array_agg(id order by id) into v_carts from public.reseller_carts
    where id = any(p_cart_ids) and status = 'open';
  if v_carts is null then return null; end if;
  perform 1 from public.reseller_carts where id = any(v_carts) for update;

  if p_group is not null then
    select id into v_delivery_id from public.deliveries
      where delivery_group_id = p_group and status = 'pending_confirmation'
      order by created_at limit 1 for update;
  end if;
  if v_delivery_id is null then
    insert into public.deliveries (delivery_group_id, trigger_type, triggered_by_reseller_id)
      values (p_group, p_trigger, p_triggered_by) returning id into v_delivery_id;
    insert into public.reseller_order_fulfillments (delivery_id) values (v_delivery_id);
  end if;

  insert into public.delivery_carts (delivery_id, cart_id)
    select v_delivery_id, unnest(v_carts) on conflict do nothing;
  update public.reseller_carts set status = 'pending_delivery' where id = any(v_carts);
  return v_delivery_id;
end
$$;

-- Adds confirmed quantities to the reseller's open cart and reserves the stock.
create function private.cart_add_items(p_reseller_id uuid, p_items jsonb, p_source text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_reseller public.resellers%rowtype;
  v_cart_id uuid;
  v_item jsonb;
  v_product uuid;
  v_quantity integer;
  v_request_id uuid;
  v_cart_item_id uuid;
  v_added integer := 0;
  v_units integer := 0;
  v_group uuid;
  v_delivery uuid;
begin
  select * into v_reseller from public.resellers where id = p_reseller_id and active for update;
  if not found then raise exception 'Reseller not found' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0
    or jsonb_array_length(p_items) > 200 then
    raise exception 'Invalid items' using errcode = '22023';
  end if;

  select id into v_cart_id from public.reseller_carts where reseller_id = p_reseller_id and status = 'open';
  if v_cart_id is null then
    insert into public.reseller_carts (reseller_id) values (p_reseller_id) returning id into v_cart_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity is null or v_quantity < 1 or v_quantity > 100000 then
      raise exception 'Invalid quantity' using errcode = '22023';
    end if;
    perform 1 from public.products where id = v_product and active;
    if not found then raise exception 'Unknown product' using errcode = '22023'; end if;

    insert into public.refill_requests (reseller_id, source, phone_number, quantity, status, confirmed_at)
      values (p_reseller_id, p_source, case when p_source = 'whatsapp' then v_reseller.contact_phone end,
        v_quantity, 'confirmed', now())
      returning id into v_request_id;
    insert into public.reseller_cart_items (cart_id, product_id, quantity_needed, refill_request_id)
      values (v_cart_id, v_product, v_quantity, v_request_id) returning id into v_cart_item_id;
    update public.refill_requests set cart_item_id = v_cart_item_id where id = v_request_id;
    insert into public.warehouse_stock (product_id, quantity_reserved) values (v_product, v_quantity)
      on conflict (product_id) do update
      set quantity_reserved = public.warehouse_stock.quantity_reserved + excluded.quantity_reserved, updated_at = now();
    v_added := v_added + 1;
    v_units := v_units + v_quantity;
  end loop;

  update public.reseller_carts set countdown_started_at = coalesce(countdown_started_at, now()) where id = v_cart_id;
  perform private.notify('operator_depozit', 'refill_nou',
    'Refill nou: ' || v_reseller.business_name || ' — ' || v_units || ' buc. de pus pe raftul rezervat.',
    'reseller_cart', v_cart_id);

  -- Trigger 2: an important client gets a next-day delivery proposal with its route.
  if v_reseller.is_important_client then
    v_group := private.reseller_group(p_reseller_id);
    v_delivery := private.propose_delivery(
      array[v_cart_id] || coalesce((
        select array_agg(c.id) from public.reseller_carts c
        join public.reseller_delivery_groups rg on rg.reseller_id = c.reseller_id
        where c.status = 'open' and v_group is not null and rg.delivery_group_id = v_group), '{}'),
      'important_client', v_group, p_reseller_id);
    if v_delivery is not null then
      perform private.notify('operator_depozit', 'livrare_client_important',
        'Client important: ' || v_reseller.business_name || ' cere livrare mâine. Confirmă traseul propus.',
        'delivery', v_delivery);
    end if;
  end if;

  return jsonb_build_object('cart_id', v_cart_id, 'items', v_added, 'units', v_units);
end
$$;

-- Trigger 3: carts open for more than 48h become a delivery proposal with a persistent alert.
create function private.process_refill_countdowns() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_cart record;
  v_delivery uuid;
  v_count integer := 0;
begin
  for v_cart in
    select c.id, c.reseller_id, r.business_name, private.reseller_group(c.reseller_id) as group_id
    from public.reseller_carts c join public.resellers r on r.id = c.reseller_id
    where c.status = 'open' and c.countdown_started_at < now() - interval '48 hours'
    order by c.countdown_started_at
  loop
    v_delivery := private.propose_delivery(array[v_cart.id], 'countdown_48h', v_cart.group_id, v_cart.reseller_id);
    if v_delivery is not null then
      v_count := v_count + 1;
      perform private.notify('operator_depozit', 'countdown_48h',
        'Coșul ' || v_cart.business_name || ' a depășit 48h fără livrare.', 'delivery', v_delivery);
    end if;
  end loop;
  return v_count;
end
$$;

create function private.is_staff(p_roles public.user_role[]) returns boolean
language sql stable security definer set search_path = ''
as $$ select (select auth.uid()) is not null and coalesce((select private.current_role()) = any(p_roles), false) $$;

-- ---------- guarded RPCs ----------

-- Reseller reports what is left on the shelf; the app orders the gap up to the par level,
-- minus what is already in a cart or on the way.
create function private.submit_refill_counts(p_counts jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_reseller_id uuid;
  v_items jsonb := '[]'::jsonb;
  v_row record;
begin
  select id into v_reseller_id from public.resellers where auth_user_id = (select auth.uid()) and active;
  if v_reseller_id is null then raise exception 'Access denied' using errcode = '42501'; end if;
  if jsonb_typeof(p_counts) is distinct from 'array' or jsonb_array_length(p_counts) > 500 then
    raise exception 'Invalid counts' using errcode = '22023';
  end if;

  for v_row in
    select pl.product_id,
      pl.par_level_quantity - greatest(0, (c->>'remaining')::integer) - coalesce((
        select sum(i.quantity_needed) from public.reseller_cart_items i
        join public.reseller_carts rc on rc.id = i.cart_id
        where rc.reseller_id = v_reseller_id and rc.status in ('open', 'pending_delivery')
          and i.product_id = pl.product_id), 0) as needed
    from jsonb_array_elements(p_counts) c
    join public.reseller_par_levels pl on pl.reseller_id = v_reseller_id and pl.product_id = (c->>'product_id')::uuid
    join public.products p on p.id = pl.product_id and p.active
    where (c->>'remaining') ~ '^\d{1,6}$'
  loop
    if v_row.needed > 0 then
      v_items := v_items || jsonb_build_object('product_id', v_row.product_id, 'quantity', v_row.needed);
    end if;
  end loop;

  if jsonb_array_length(v_items) = 0 then
    return jsonb_build_object('items', 0, 'units', 0);
  end if;
  return private.cart_add_items(v_reseller_id, v_items, 'app');
end
$$;

-- Operators type in requests that arrive by WhatsApp or phone until the bot is live.
create function private.staff_add_refill(p_reseller_id uuid, p_items jsonb, p_source text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_staff(array['admin', 'operator_depozit']::public.user_role[]) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_source not in ('whatsapp', 'app', 'telefon') then
    raise exception 'Invalid source' using errcode = '22023';
  end if;
  return private.cart_add_items(p_reseller_id, p_items, p_source);
end
$$;

create function private.remove_cart_item(p_item_id uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_item record;
begin
  select i.id, i.product_id, i.quantity_needed, i.refill_request_id, c.reseller_id, c.id as cart_id
    into v_item
    from public.reseller_cart_items i join public.reseller_carts c on c.id = i.cart_id
    where i.id = p_item_id and c.status = 'open' for update of i, c;
  if not found then return false; end if;
  if not (private.is_staff(array['admin', 'operator_depozit']::public.user_role[])
    or exists (select 1 from public.resellers r where r.id = v_item.reseller_id
      and r.auth_user_id = (select auth.uid()) and r.active)) then
    return false;
  end if;

  update public.refill_requests set cart_item_id = null, status = 'rejected' where id = v_item.refill_request_id;
  delete from public.reseller_cart_items where id = p_item_id;
  update public.warehouse_stock
    set quantity_reserved = greatest(0, quantity_reserved - v_item.quantity_needed), updated_at = now()
    where product_id = v_item.product_id;
  -- An emptied cart stops its 48h countdown.
  update public.reseller_carts set countdown_started_at = null
    where id = v_item.cart_id and not exists (select 1 from public.reseller_cart_items where cart_id = v_item.cart_id);
  return true;
end
$$;

-- Trigger 1: the dispatcher groups open carts into a delivery.
create function private.create_manual_delivery(p_cart_ids uuid[], p_group uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_staff(array['admin', 'operator_depozit']::public.user_role[]) then return null; end if;
  if p_cart_ids is null or cardinality(p_cart_ids) = 0 or cardinality(p_cart_ids) > 200 then return null; end if;
  return private.propose_delivery(p_cart_ids, 'manual', p_group, null);
end
$$;

create function private.release_cart_from_delivery(p_delivery_id uuid, p_cart_id uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_staff(array['admin', 'operator_depozit']::public.user_role[]) then return false; end if;
  perform 1 from public.deliveries where id = p_delivery_id and status = 'pending_confirmation' for update;
  if not found then return false; end if;
  perform 1 from public.delivery_carts where delivery_id = p_delivery_id and cart_id = p_cart_id;
  if not found then return false; end if;
  -- A reseller can hold only one open cart; merge back into it if one was started meanwhile.
  if exists (select 1 from public.reseller_carts o join public.reseller_carts c on c.reseller_id = o.reseller_id
      where c.id = p_cart_id and o.status = 'open') then
    update public.reseller_cart_items set cart_id = (
        select o.id from public.reseller_carts o join public.reseller_carts c on c.reseller_id = o.reseller_id
        where c.id = p_cart_id and o.status = 'open')
      where cart_id = p_cart_id;
    update public.reseller_carts o set countdown_started_at = least(o.countdown_started_at, c.countdown_started_at)
      from public.reseller_carts c where c.id = p_cart_id and o.reseller_id = c.reseller_id and o.status = 'open';
    delete from public.delivery_carts where delivery_id = p_delivery_id and cart_id = p_cart_id;
    delete from public.reseller_carts where id = p_cart_id;
  else
    delete from public.delivery_carts where delivery_id = p_delivery_id and cart_id = p_cart_id;
    update public.reseller_carts set status = 'open' where id = p_cart_id;
  end if;
  delete from public.deliveries d where d.id = p_delivery_id
    and not exists (select 1 from public.delivery_carts dc where dc.delivery_id = d.id);
  return true;
end
$$;

create function private.cancel_delivery(p_delivery_id uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_cart uuid;
begin
  if not private.is_staff(array['admin', 'operator_depozit']::public.user_role[]) then return false; end if;
  perform 1 from public.deliveries where id = p_delivery_id and status = 'pending_confirmation' for update;
  if not found then return false; end if;
  for v_cart in select cart_id from public.delivery_carts where delivery_id = p_delivery_id loop
    perform private.release_cart_from_delivery(p_delivery_id, v_cart);
  end loop;
  delete from public.deliveries where id = p_delivery_id;
  return true;
end
$$;

-- Goods are physically prepared: the delivery goes to billing (reverse flow).
create function private.confirm_delivery_ready(p_delivery_id uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_group text;
begin
  if not private.is_staff(array['admin', 'operator_depozit']::public.user_role[]) then return false; end if;
  update public.deliveries set status = 'confirmed', confirmed_by = (select auth.uid()), confirmed_at = now()
    where id = p_delivery_id and status = 'pending_confirmation'
      and exists (select 1 from public.delivery_carts where delivery_id = p_delivery_id);
  if not found then return false; end if;
  update public.reseller_order_fulfillments
    set status = 'ready_to_deliver', ready_confirmed_by = (select auth.uid()), ready_confirmed_at = now()
    where delivery_id = p_delivery_id;
  select coalesce(g.name, 'fără grup') into v_group from public.deliveries d
    left join public.delivery_groups g on g.id = d.delivery_group_id where d.id = p_delivery_id;
  perform private.notify('operator_facturare', 'refill_de_facturat',
    'Livrare refill pregătită (' || v_group || '). Emite factura.', 'delivery', p_delivery_id);
  return true;
end
$$;

-- The app stops at "handed to the driver/courier"; reserved stock leaves the warehouse.
create function private.hand_delivery_to_driver(p_delivery_id uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_staff(array['admin', 'operator_depozit']::public.user_role[]) then return false; end if;
  update public.deliveries set status = 'completed', completed_at = now()
    where id = p_delivery_id and status = 'confirmed'
      and exists (select 1 from public.reseller_order_fulfillments f
        where f.delivery_id = p_delivery_id and f.status = 'invoiced');
  if not found then return false; end if;
  update public.reseller_order_fulfillments set status = 'delivered', delivered_at = now()
    where delivery_id = p_delivery_id;
  update public.warehouse_stock s
    set quantity_reserved = greatest(0, s.quantity_reserved - t.units), updated_at = now()
    from (
      select i.product_id, sum(i.quantity_needed) as units
      from public.delivery_carts dc join public.reseller_cart_items i on i.cart_id = dc.cart_id
      where dc.delivery_id = p_delivery_id group by i.product_id
    ) t where s.product_id = t.product_id;
  update public.reseller_carts set status = 'delivered', delivered_at = now()
    where id in (select cart_id from public.delivery_carts where delivery_id = p_delivery_id);
  return true;
end
$$;

create function private.run_refill_countdowns() returns integer
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_staff(array['admin', 'operator_depozit']::public.user_role[]) then return 0; end if;
  return private.process_refill_countdowns();
end
$$;

-- Links a reseller location to a login created in Supabase Auth (no service key needed).
create function private.link_reseller_account(p_reseller_id uuid, p_email text) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_user_id uuid;
begin
  if not private.is_staff(array['admin']::public.user_role[]) then return 'denied'; end if;
  if p_email is null or trim(p_email) = '' then
    update public.resellers set auth_user_id = null where id = p_reseller_id;
    return case when found then 'unlinked' else 'not_found' end;
  end if;
  select id into v_user_id from auth.users where lower(email) = lower(trim(p_email));
  if v_user_id is null then return 'no_user'; end if;
  if exists (select 1 from public.app_users where id = v_user_id) then return 'staff_account'; end if;
  if exists (select 1 from public.resellers where auth_user_id = v_user_id and id <> p_reseller_id) then
    return 'already_linked';
  end if;
  update public.resellers set auth_user_id = v_user_id where id = p_reseller_id;
  return case when found then 'linked' else 'not_found' end;
end
$$;

-- Role notifications are a shared team queue: marking one read clears it for the role.
create function private.mark_notifications_read(p_ids uuid[]) returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_count integer;
begin
  if (select auth.uid()) is null then return 0; end if;
  update public.notifications n set read_at = now()
    where n.read_at is null and (p_ids is null or n.id = any(p_ids))
      and (n.recipient_user_id = (select auth.uid())
        or (n.recipient_role is not null and n.recipient_role = (select private.current_role()))
        or exists (select 1 from public.resellers r where r.id = n.recipient_reseller_id
          and r.auth_user_id = (select auth.uid()) and r.active));
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- ---------- grants and public wrappers ----------

do $$
declare signature text;
begin
  foreach signature in array array[
    'private.submit_refill_counts(jsonb)',
    'private.staff_add_refill(uuid, jsonb, text)',
    'private.remove_cart_item(uuid)',
    'private.create_manual_delivery(uuid[], uuid)',
    'private.release_cart_from_delivery(uuid, uuid)',
    'private.cancel_delivery(uuid)',
    'private.confirm_delivery_ready(uuid)',
    'private.hand_delivery_to_driver(uuid)',
    'private.run_refill_countdowns()',
    'private.link_reseller_account(uuid, text)',
    'private.mark_notifications_read(uuid[])'
  ] loop
    execute format('revoke all on function %s from public, anon', signature);
    execute format('grant execute on function %s to authenticated', signature);
  end loop;
  foreach signature in array array[
    'private.notify(public.user_role, text, text, text, uuid)',
    'private.reseller_group(uuid)',
    'private.propose_delivery(uuid[], public.delivery_trigger_type, uuid, uuid)',
    'private.cart_add_items(uuid, jsonb, text)',
    'private.process_refill_countdowns()',
    'private.is_staff(public.user_role[])'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', signature);
  end loop;
end $$;
-- is_staff runs inside the definer functions above, as their owner; nothing else needs it.

create function public.submit_refill_counts(p_counts jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.submit_refill_counts(p_counts) $$;
create function public.staff_add_refill(p_reseller_id uuid, p_items jsonb, p_source text) returns jsonb
language sql security invoker set search_path = '' as $$ select private.staff_add_refill(p_reseller_id, p_items, p_source) $$;
create function public.remove_cart_item(p_item_id uuid) returns boolean
language sql security invoker set search_path = '' as $$ select private.remove_cart_item(p_item_id) $$;
create function public.create_manual_delivery(p_cart_ids uuid[], p_group uuid) returns uuid
language sql security invoker set search_path = '' as $$ select private.create_manual_delivery(p_cart_ids, p_group) $$;
create function public.release_cart_from_delivery(p_delivery_id uuid, p_cart_id uuid) returns boolean
language sql security invoker set search_path = '' as $$ select private.release_cart_from_delivery(p_delivery_id, p_cart_id) $$;
create function public.cancel_delivery(p_delivery_id uuid) returns boolean
language sql security invoker set search_path = '' as $$ select private.cancel_delivery(p_delivery_id) $$;
create function public.confirm_delivery_ready(p_delivery_id uuid) returns boolean
language sql security invoker set search_path = '' as $$ select private.confirm_delivery_ready(p_delivery_id) $$;
create function public.hand_delivery_to_driver(p_delivery_id uuid) returns boolean
language sql security invoker set search_path = '' as $$ select private.hand_delivery_to_driver(p_delivery_id) $$;
create function public.run_refill_countdowns() returns integer
language sql security invoker set search_path = '' as $$ select private.run_refill_countdowns() $$;
create function public.link_reseller_account(p_reseller_id uuid, p_email text) returns text
language sql security invoker set search_path = '' as $$ select private.link_reseller_account(p_reseller_id, p_email) $$;
create function public.mark_notifications_read(p_ids uuid[]) returns integer
language sql security invoker set search_path = '' as $$ select private.mark_notifications_read(p_ids) $$;

-- Billing hands the invoiced delivery back to the warehouse.
create or replace function private.mark_fulfillment_invoiced(p_fulfillment_id uuid, p_invoice_number text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_delivery uuid;
begin
  update public.reseller_order_fulfillments
    set status = 'invoiced', invoiced_by = (select auth.uid()), invoiced_at = now(),
      invoice_number = trim(p_invoice_number)
    where id = p_fulfillment_id and status = 'ready_to_deliver'
      and length(trim(coalesce(p_invoice_number, ''))) between 1 and 60
      and (select auth.uid()) is not null
      and coalesce((select private.current_role()) in ('admin', 'operator_facturare'), false)
    returning delivery_id into v_delivery;
  if v_delivery is null then return false; end if;
  perform private.notify('operator_depozit', 'refill_facturat',
    'Factura ' || trim(p_invoice_number) || ' a fost emisă. Livrarea poate pleca.', 'delivery', v_delivery);
  return true;
end
$$;

-- Live updates for the refill board and the notification badge (RLS still applies).
alter publication supabase_realtime add table public.notifications, public.reseller_carts,
  public.reseller_cart_items, public.deliveries, public.reseller_order_fulfillments;

-- Trigger 3 runs even when nobody has the board open.
create extension if not exists pg_cron;
select cron.schedule('refill-countdown-48h', '*/15 * * * *', $$select private.process_refill_countdowns()$$);
