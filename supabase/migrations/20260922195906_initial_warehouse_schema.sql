-- Initial schema for Atelier Rebul warehouse operations.
-- BOCP remains the source of truth for global stock and invoices.

create type public.user_role as enum ('admin', 'owner', 'operator_depozit', 'operator_facturare');
create type public.refill_request_status as enum ('pending_confirmation', 'confirmed', 'rejected', 'flagged_for_review');
create type public.cart_status as enum ('open', 'pending_delivery', 'delivered');
create type public.delivery_trigger_type as enum ('manual', 'important_client', 'countdown_48h');
create type public.delivery_status as enum ('pending_confirmation', 'confirmed', 'in_transit', 'completed');
create type public.online_order_status as enum ('pending', 'claimed', 'preparing', 'ready', 'handed_to_courier', 'returned');
create type public.reseller_order_status as enum ('preparing', 'ready_to_deliver', 'invoiced', 'delivered');
create type public.return_reason as enum ('neridicat', 'refuzat_livrare', 'produs_deteriorat', 'altul');
create type public.return_status as enum ('pending_restock', 'restocked');
create type public.notification_channel as enum ('in_app', 'email', 'browser', 'whatsapp');
create type public.order_source as enum ('shopify', 'marketplace');

create table public.app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.user_role not null,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.reseller_companies (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  created_at timestamptz not null default now()
);

create table public.resellers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.reseller_companies(id),
  business_name text not null,
  location_name text not null,
  contact_phone text not null unique,
  contact_email text,
  is_important_client boolean not null default false,
  auth_user_id uuid unique references auth.users(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.delivery_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table public.reseller_delivery_groups (
  reseller_id uuid not null references public.resellers(id) on delete cascade,
  delivery_group_id uuid not null references public.delivery_groups(id) on delete cascade,
  primary key (reseller_id, delivery_group_id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  ean text unique,
  name text not null,
  variant_label text,
  category text,
  bocp_product_id text unique,
  image_url text,
  active boolean not null default true,
  synced_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.reseller_par_levels (
  id uuid primary key default gen_random_uuid(),
  reseller_id uuid not null references public.resellers(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  par_level_quantity integer not null check (par_level_quantity >= 0),
  set_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reseller_id, product_id)
);

create table public.warehouse_stock (
  product_id uuid primary key references public.products(id) on delete cascade,
  quantity_bocp_global integer not null default 0 check (quantity_bocp_global >= 0),
  quantity_reserved integer not null default 0 check (quantity_reserved >= 0),
  updated_at timestamptz not null default now()
);

create table public.refill_requests (
  id uuid primary key default gen_random_uuid(),
  reseller_id uuid references public.resellers(id),
  source text not null default 'whatsapp' check (source in ('whatsapp', 'app')),
  phone_number text,
  image_url text,
  raw_text text,
  ai_read_label_text text,
  ai_matched_product_id uuid references public.products(id),
  ai_confidence numeric(3,2) check (ai_confidence between 0 and 1),
  quantity integer check (quantity > 0),
  status public.refill_request_status not null default 'pending_confirmation',
  confirmed_at timestamptz,
  cart_item_id uuid,
  created_at timestamptz not null default now()
);

create table public.reseller_carts (
  id uuid primary key default gen_random_uuid(),
  reseller_id uuid not null references public.resellers(id) on delete cascade,
  status public.cart_status not null default 'open',
  countdown_started_at timestamptz,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create unique index reseller_one_active_cart on public.reseller_carts (reseller_id)
  where status in ('open', 'pending_delivery');

create table public.reseller_cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.reseller_carts(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity_needed integer not null check (quantity_needed > 0),
  refill_request_id uuid unique references public.refill_requests(id),
  created_at timestamptz not null default now()
);
alter table public.refill_requests add constraint refill_request_cart_item_fk
  foreign key (cart_item_id) references public.reseller_cart_items(id);

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  delivery_group_id uuid references public.delivery_groups(id),
  trigger_type public.delivery_trigger_type not null,
  triggered_by_reseller_id uuid references public.resellers(id),
  status public.delivery_status not null default 'pending_confirmation',
  route_order jsonb,
  confirmed_by uuid references public.app_users(id),
  confirmed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.delivery_carts (
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  cart_id uuid not null references public.reseller_carts(id) on delete cascade,
  primary key (delivery_id, cart_id),
  unique (cart_id)
);

create table public.reseller_order_fulfillments (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null unique references public.deliveries(id) on delete cascade,
  status public.reseller_order_status not null default 'preparing',
  ready_confirmed_by uuid references public.app_users(id),
  ready_confirmed_at timestamptz,
  invoiced_by uuid references public.app_users(id),
  invoice_number text,
  invoiced_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.online_orders (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  bocp_order_id text,
  source public.order_source not null,
  customer_name text,
  customer_phone text,
  customer_email text,
  shipping_address text,
  status public.online_order_status not null default 'pending',
  claimed_by uuid references public.app_users(id),
  claimed_at timestamptz,
  released_at timestamptz,
  completed_at timestamptz,
  courier_type text check (courier_type in ('sofer_propriu', 'curier_extern')),
  invoice_pdf_url text,
  created_at timestamptz not null default now(),
  constraint online_order_claim_state check (
    (status = 'pending' and claimed_by is null)
    or (status <> 'pending' and claimed_by is not null)
  )
);

create table public.online_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.online_orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  ean text not null,
  quantity integer not null check (quantity > 0),
  scanned_quantity integer not null default 0,
  created_at timestamptz not null default now(),
  constraint scanned_quantity_bounds check (scanned_quantity >= 0 and scanned_quantity <= quantity)
);

create table public.order_returns (
  id uuid primary key default gen_random_uuid(),
  online_order_id uuid not null references public.online_orders(id),
  reason public.return_reason not null default 'neridicat',
  status public.return_status not null default 'pending_restock',
  registered_by uuid references public.app_users(id),
  shopify_marked_manually boolean not null default false,
  registered_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_role public.user_role,
  recipient_user_id uuid references public.app_users(id),
  recipient_reseller_id uuid references public.resellers(id),
  type text not null,
  message text not null,
  related_entity_type text,
  related_entity_id uuid,
  channel public.notification_channel not null default 'in_app',
  read_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notification_has_recipient check (num_nonnulls(recipient_role, recipient_user_id, recipient_reseller_id) = 1)
);

create index resellers_company_idx on public.resellers(company_id);
create index reseller_groups_group_idx on public.reseller_delivery_groups(delivery_group_id);
create index par_levels_product_idx on public.reseller_par_levels(product_id);
create index refill_requests_reseller_created_idx on public.refill_requests(reseller_id, created_at desc);
create index refill_requests_status_idx on public.refill_requests(status) where status = 'flagged_for_review';
create index reseller_carts_reseller_created_idx on public.reseller_carts(reseller_id, created_at desc);
create index cart_items_cart_idx on public.reseller_cart_items(cart_id);
create index cart_items_product_idx on public.reseller_cart_items(product_id);
create index deliveries_group_created_idx on public.deliveries(delivery_group_id, created_at desc);
create index delivery_carts_cart_idx on public.delivery_carts(cart_id);
create index online_orders_board_idx on public.online_orders(status, created_at desc);
create index online_orders_claimed_by_idx on public.online_orders(claimed_by) where claimed_by is not null;
create index online_order_items_order_idx on public.online_order_items(order_id);
create index order_returns_order_idx on public.order_returns(online_order_id);
create index notifications_user_idx on public.notifications(recipient_user_id, created_at desc);
create index notifications_role_idx on public.notifications(recipient_role, created_at desc);

-- Authorization comes from the server-managed profile, never user_metadata.
create schema private;
create function private.current_role() returns public.user_role
language sql stable security definer set search_path = ''
as $$
  select u.role from public.app_users u
  where u.id = (select auth.uid()) and u.active = true
$$;
revoke all on function private.current_role() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.current_role() to authenticated;

-- Every exposed table is deny-by-default until an explicit policy matches.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'app_users', 'reseller_companies', 'resellers', 'delivery_groups',
    'reseller_delivery_groups', 'products', 'reseller_par_levels', 'warehouse_stock',
    'refill_requests', 'reseller_carts', 'reseller_cart_items', 'deliveries',
    'delivery_carts', 'reseller_order_fulfillments', 'online_orders',
    'online_order_items', 'order_returns', 'notifications'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create policy admin_all on public.%I for all to authenticated using ((select private.current_role()) = ''admin'') with check ((select private.current_role()) = ''admin'')', table_name);
  end loop;
end $$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

create policy own_profile on public.app_users for select to authenticated
  using (id = (select auth.uid()));

create policy staff_companies on public.reseller_companies for select to authenticated
  using ((select private.current_role()) in ('operator_depozit', 'operator_facturare'));
create policy staff_resellers on public.resellers for select to authenticated
  using ((select private.current_role()) in ('operator_depozit', 'operator_facturare'));
create policy own_reseller on public.resellers for select to authenticated
  using (auth_user_id = (select auth.uid()) and active = true);
create policy staff_delivery_groups on public.delivery_groups for select to authenticated
  using ((select private.current_role()) in ('operator_depozit', 'operator_facturare'));
create policy staff_reseller_groups on public.reseller_delivery_groups for select to authenticated
  using ((select private.current_role()) in ('operator_depozit', 'operator_facturare'));
create policy catalog_read on public.products for select to authenticated
  using ((select private.current_role()) in ('operator_depozit', 'operator_facturare')
    or (active = true and exists (select 1 from public.resellers r where r.auth_user_id = (select auth.uid()) and r.active)));
create policy staff_par_levels on public.reseller_par_levels for select to authenticated
  using ((select private.current_role()) in ('operator_depozit', 'operator_facturare'));
create policy own_par_levels on public.reseller_par_levels for select to authenticated
  using (exists (select 1 from public.resellers r where r.id = reseller_id and r.auth_user_id = (select auth.uid()) and r.active));
create policy staff_stock on public.warehouse_stock for select to authenticated
  using ((select private.current_role()) in ('operator_depozit', 'operator_facturare'));
create policy staff_refill_requests on public.refill_requests for select to authenticated
  using ((select private.current_role()) in ('operator_depozit', 'operator_facturare'));
create policy own_refill_requests on public.refill_requests for select to authenticated
  using (exists (select 1 from public.resellers r where r.id = reseller_id and r.auth_user_id = (select auth.uid()) and r.active));
create policy staff_carts on public.reseller_carts for select to authenticated
  using ((select private.current_role()) in ('operator_depozit', 'operator_facturare'));
create policy own_carts on public.reseller_carts for select to authenticated
  using (exists (select 1 from public.resellers r where r.id = reseller_id and r.auth_user_id = (select auth.uid()) and r.active));
create policy staff_cart_items on public.reseller_cart_items for select to authenticated
  using ((select private.current_role()) in ('operator_depozit', 'operator_facturare'));
create policy own_cart_items on public.reseller_cart_items for select to authenticated
  using (exists (select 1 from public.reseller_carts c join public.resellers r on r.id = c.reseller_id
    where c.id = cart_id and r.auth_user_id = (select auth.uid()) and r.active));
create policy staff_deliveries on public.deliveries for select to authenticated
  using ((select private.current_role()) in ('operator_depozit', 'operator_facturare'));
create policy staff_delivery_carts on public.delivery_carts for select to authenticated
  using ((select private.current_role()) in ('operator_depozit', 'operator_facturare'));
create policy staff_fulfillments on public.reseller_order_fulfillments for select to authenticated
  using ((select private.current_role()) in ('operator_depozit', 'operator_facturare'));
create policy staff_online_orders on public.online_orders for select to authenticated
  using ((select private.current_role()) in ('operator_depozit', 'operator_facturare'));
create policy warehouse_update_order on public.online_orders for update to authenticated
  using ((select private.current_role()) = 'operator_depozit'
    and (status = 'pending' or claimed_by = (select auth.uid())))
  with check ((select private.current_role()) = 'operator_depozit'
    and (claimed_by = (select auth.uid()) or (status = 'pending' and claimed_by is null)));
create policy staff_online_items on public.online_order_items for select to authenticated
  using ((select private.current_role()) in ('operator_depozit', 'operator_facturare'));
create policy warehouse_scan_item on public.online_order_items for update to authenticated
  using ((select private.current_role()) = 'operator_depozit' and exists (
    select 1 from public.online_orders o where o.id = order_id and o.claimed_by = (select auth.uid())
      and o.status in ('claimed', 'preparing')))
  with check ((select private.current_role()) = 'operator_depozit' and exists (
    select 1 from public.online_orders o where o.id = order_id and o.claimed_by = (select auth.uid())
      and o.status in ('claimed', 'preparing')));
create policy staff_returns on public.order_returns for select to authenticated
  using ((select private.current_role()) in ('operator_depozit', 'operator_facturare'));
create policy billing_insert_return on public.order_returns for insert to authenticated
  with check ((select private.current_role()) = 'operator_facturare' and registered_by = (select auth.uid()));
create policy billing_update_return on public.order_returns for update to authenticated
  using ((select private.current_role()) = 'operator_facturare')
  with check ((select private.current_role()) = 'operator_facturare');
create policy own_notifications on public.notifications for select to authenticated
  using (recipient_user_id = (select auth.uid())
    or (recipient_role is not null and recipient_role = (select private.current_role()))
    or exists (select 1 from public.resellers r where r.id = recipient_reseller_id
      and r.auth_user_id = (select auth.uid()) and r.active));

-- The first operational slice: atomic claim, release, scan, and handoff.
-- These are invoker functions; table RLS still applies to every statement.
create function public.claim_online_order(p_order_id uuid) returns boolean
language sql security invoker set search_path = ''
as $$
  with changed as (
    update public.online_orders
    set status = 'claimed', claimed_by = (select auth.uid()), claimed_at = now(), released_at = null
    where id = p_order_id and status = 'pending' and claimed_by is null
      and (select private.current_role()) in ('admin', 'operator_depozit')
    returning id
  )
  select exists (select 1 from changed)
$$;

create function public.release_online_order(p_order_id uuid) returns boolean
language plpgsql security invoker set search_path = ''
as $$
begin
  if (select private.current_role()) not in ('admin', 'operator_depozit') then return false; end if;
  if not exists (select 1 from public.online_orders
    where id = p_order_id and claimed_by = (select auth.uid()) and status in ('claimed', 'preparing')) then
    return false;
  end if;
  update public.online_order_items set scanned_quantity = 0 where order_id = p_order_id;
  update public.online_orders
    set status = 'pending', claimed_by = null, claimed_at = null, released_at = now()
    where id = p_order_id and claimed_by = (select auth.uid()) and status in ('claimed', 'preparing');
  return found;
end
$$;

create function public.scan_online_order_item(p_order_id uuid, p_ean text) returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare v_item_id uuid;
begin
  if (select private.current_role()) not in ('admin', 'operator_depozit') then return false; end if;
  select i.id into v_item_id from public.online_order_items i
    join public.online_orders o on o.id = i.order_id
    where i.order_id = p_order_id and i.ean = trim(p_ean)
      and i.scanned_quantity < i.quantity
      and o.claimed_by = (select auth.uid()) and o.status in ('claimed', 'preparing')
    order by i.created_at, i.id limit 1;
  if v_item_id is null then return false; end if;
  update public.online_orders set status = 'preparing'
    where id = p_order_id and claimed_by = (select auth.uid()) and status in ('claimed', 'preparing');
  update public.online_order_items set scanned_quantity = scanned_quantity + 1
    where id = v_item_id and scanned_quantity < quantity;
  return found;
end
$$;

create function public.mark_online_order_ready(p_order_id uuid) returns boolean
language sql security invoker set search_path = ''
as $$
  with changed as (
    update public.online_orders o set status = 'ready'
    where o.id = p_order_id and o.claimed_by = (select auth.uid())
      and o.status in ('claimed', 'preparing')
      and (select private.current_role()) in ('admin', 'operator_depozit')
      and exists (select 1 from public.online_order_items i where i.order_id = o.id)
      and not exists (select 1 from public.online_order_items i
        where i.order_id = o.id and i.scanned_quantity < i.quantity)
    returning id
  )
  select exists (select 1 from changed)
$$;

create function public.hand_online_order_to_courier(p_order_id uuid) returns boolean
language sql security invoker set search_path = ''
as $$
  with changed as (
    update public.online_orders set status = 'handed_to_courier', completed_at = now()
    where id = p_order_id and claimed_by = (select auth.uid()) and status = 'ready'
      and (select private.current_role()) in ('admin', 'operator_depozit')
    returning id
  )
  select exists (select 1 from changed)
$$;

revoke all on function public.claim_online_order(uuid) from public, anon;
revoke all on function public.release_online_order(uuid) from public, anon;
revoke all on function public.scan_online_order_item(uuid, text) from public, anon;
revoke all on function public.mark_online_order_ready(uuid) from public, anon;
revoke all on function public.hand_online_order_to_courier(uuid) from public, anon;
grant execute on function public.claim_online_order(uuid) to authenticated;
grant execute on function public.release_online_order(uuid) to authenticated;
grant execute on function public.scan_online_order_item(uuid, text) to authenticated;
grant execute on function public.mark_online_order_ready(uuid) to authenticated;
grant execute on function public.hand_online_order_to_courier(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.online_orders, public.online_order_items;
  end if;
end $$;
