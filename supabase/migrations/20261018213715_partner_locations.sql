-- Multi-location clients. A partner is the client (one CUI: billing, agent, discounts); its points of work
-- (puncte de lucru) are where products are delivered. Stock mode: 'central' = one par-level set and one
-- order for the firm, delivered to the main point; 'per_location' = each point has its own stock and orders.

create table public.partner_locations (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  city text check (length(city) <= 120),
  address text check (length(address) <= 300),
  contact_name text check (length(contact_name) <= 120),
  contact_phone text check (length(contact_phone) <= 40),
  is_main boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index partner_locations_one_main on public.partner_locations (partner_id) where is_main;
create index partner_locations_partner_idx on public.partner_locations (partner_id);
alter table public.partner_locations enable row level security;
create policy staff_read on public.partner_locations for select to authenticated
  using ((select private.current_role()) in ('admin', 'owner', 'operator_depozit', 'operator_facturare'));
create policy account_own on public.partner_locations for select to authenticated
  using ((select private.current_role()) = 'account' and exists (select 1 from public.partners p where p.id = partner_id and p.account_id = (select auth.uid())));
create policy partner_own on public.partner_locations for select to authenticated
  using (exists (select 1 from public.partners p where p.id = partner_id and p.auth_user_id = (select auth.uid()) and p.active));

alter table public.partners add column stock_mode text not null default 'central' check (stock_mode in ('central', 'per_location'));
alter table public.partner_par_levels add column location_id uuid references public.partner_locations(id) on delete cascade;
alter table public.partner_par_levels drop constraint partner_par_levels_partner_id_product_id_key;
alter table public.partner_par_levels add constraint partner_par_levels_unique unique nulls not distinct (partner_id, location_id, product_id);
alter table public.partner_carts add column location_id uuid references public.partner_locations(id) on delete set null;
alter table public.partner_backorders add column location_id uuid references public.partner_locations(id) on delete set null;
create index partner_carts_location_idx on public.partner_carts (location_id);

-- Every client gets its main point from what it has today; existing orders go there.
insert into public.partner_locations (partner_id, name, city, address, contact_phone, is_main)
  select id, coalesce(nullif(trim(location_name), ''), business_name), billing_city, billing_street, contact_phone, true from public.partners;
update public.partner_carts c set location_id = l.id from public.partner_locations l where l.partner_id = c.partner_id and l.is_main;
update public.partner_backorders b set location_id = l.id from public.partner_locations l where l.partner_id = b.partner_id and l.is_main;

-- New clients get their main point too.
create or replace function private.create_main_location()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into public.partner_locations (partner_id, name, city, address, contact_phone, is_main)
    values (new.id, coalesce(nullif(trim(new.location_name), ''), new.business_name), new.billing_city, new.billing_street, new.contact_phone, true);
  return new;
end
$$;
create trigger partners_main_location after insert on public.partners for each row execute function private.create_main_location();

-- Where an order of this client goes: the main point in central mode, else the chosen (or main) point.
create or replace function private.order_location(p_partner_id uuid, p_location_id uuid)
returns uuid
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    (select l.id from public.partner_locations l join public.partners p on p.id = l.partner_id
      where l.id = p_location_id and l.partner_id = p_partner_id and l.active and p.stock_mode = 'per_location'),
    (select id from public.partner_locations where partner_id = p_partner_id and is_main))
$$;

-- Cart for a point: one open cart per client and point.
drop function if exists public.staff_add_refill(uuid, jsonb, text);
drop function if exists private.staff_add_refill(uuid, jsonb, text);
drop function if exists private.cart_add_items(uuid, jsonb, text);
create function private.cart_add_items(p_partner_id uuid, p_items jsonb, p_source text, p_location_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_partner public.partners%rowtype;
  v_location uuid;
  v_location_name text;
  v_points integer;
  v_label text;
  v_cart_id uuid;
  v_item jsonb;
  v_product uuid;
  v_quantity integer;
  v_request_id uuid;
  v_cart_item_id uuid;
  v_added integer := 0;
  v_units integer := 0;
begin
  select * into v_partner from public.partners where id = p_partner_id and active for update;
  if not found then raise exception 'Partner not found' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0
    or jsonb_array_length(p_items) > 200 then
    raise exception 'Invalid items' using errcode = '22023';
  end if;
  v_location := private.order_location(p_partner_id, p_location_id);
  select name into v_location_name from public.partner_locations where id = v_location;
  select count(*) into v_points from public.partner_locations where partner_id = p_partner_id and active;
  v_label := v_partner.business_name || case when v_points > 1 then ' — ' || coalesce(v_location_name, '') else '' end;

  select id into v_cart_id from public.partner_carts
    where partner_id = p_partner_id and status = 'open' and location_id is not distinct from v_location;
  if v_cart_id is null then
    insert into public.partner_carts (partner_id, location_id) values (p_partner_id, v_location) returning id into v_cart_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity is null or v_quantity < 1 or v_quantity > 100000 then
      raise exception 'Invalid quantity' using errcode = '22023';
    end if;
    perform 1 from public.products where id = v_product and active;
    if not found then raise exception 'Unknown product' using errcode = '22023'; end if;

    insert into public.refill_requests (partner_id, source, phone_number, quantity, status, confirmed_at)
      values (p_partner_id, p_source, case when p_source = 'whatsapp' then v_partner.contact_phone end,
        v_quantity, 'confirmed', now())
      returning id into v_request_id;
    insert into public.partner_cart_items (cart_id, product_id, quantity_needed, refill_request_id)
      values (v_cart_id, v_product, v_quantity, v_request_id) returning id into v_cart_item_id;
    update public.refill_requests set cart_item_id = v_cart_item_id where id = v_request_id;
    insert into public.warehouse_stock (product_id, quantity_reserved) values (v_product, v_quantity)
      on conflict (product_id) do update
      set quantity_reserved = public.warehouse_stock.quantity_reserved + excluded.quantity_reserved, updated_at = now();
    v_added := v_added + 1;
    v_units := v_units + v_quantity;
  end loop;

  update public.partner_carts set countdown_started_at = coalesce(countdown_started_at, now()) where id = v_cart_id;
  if v_partner.is_important_client then
    perform private.notify('operator_depozit', 'client_prioritar',
      'Client prioritar: ' || v_label || ' — livrare imediată, ' || v_units || ' buc. de pregătit.',
      'partner_cart', v_cart_id);
  else
    perform private.notify('operator_depozit', 'refill_nou',
      'Refill nou: ' || v_label || ' — ' || v_units || ' buc. de pus pe raftul rezervat.',
      'partner_cart', v_cart_id);
  end if;
  if v_partner.account_id is not null and v_partner.account_id is distinct from (select auth.uid()) then
    insert into public.notifications (recipient_user_id, type, message, related_entity_type, related_entity_id)
      values (v_partner.account_id, 'cerere_client',
        'Cerere nouă de la ' || v_label || case when p_source = 'app' then ' (din aplicație)' else '' end
          || ': ' || v_units || ' buc. Depozitul o pregătește.',
        'partner_cart', v_cart_id);
  end if;

  return jsonb_build_object('cart_id', v_cart_id, 'items', v_added, 'units', v_units);
end
$$;

create function private.staff_add_refill(p_partner_id uuid, p_items jsonb, p_source text, p_location_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not (private.is_staff(array['admin', 'operator_depozit']::public.user_role[]) or private.can_manage_partner(p_partner_id)) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_source not in ('whatsapp', 'app', 'telefon') then
    raise exception 'Invalid source' using errcode = '22023';
  end if;
  return private.cart_add_items(p_partner_id, p_items, p_source, p_location_id);
end
$$;

-- What a point (or the firm, in central mode) needs: par level − on the shelf − already ordered − owed.
drop function if exists public.submit_refill_counts(jsonb);
drop function if exists public.submit_refill_counts_for(uuid, jsonb);
drop function if exists private.submit_refill_counts(jsonb);
drop function if exists private.submit_refill_counts_for(uuid, jsonb);
drop function if exists private.refill_counts_for(uuid, jsonb);
create function private.refill_counts_for(p_partner_id uuid, p_counts jsonb, p_location_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_items jsonb := '[]'::jsonb;
  v_row record;
  v_central boolean := (select stock_mode = 'central' from public.partners where id = p_partner_id);
  v_location uuid := private.order_location(p_partner_id, p_location_id);
begin
  if jsonb_typeof(p_counts) is distinct from 'array' or jsonb_array_length(p_counts) > 500 then
    raise exception 'Invalid counts' using errcode = '22023';
  end if;

  for v_row in
    select pl.product_id,
      pl.par_level_quantity - greatest(0, (c->>'remaining')::integer) - coalesce((
        select sum(i.quantity_needed) from public.partner_cart_items i
        join public.partner_carts rc on rc.id = i.cart_id
        where rc.partner_id = p_partner_id and rc.status::text in ('open', 'prepared', 'pending_delivery')
          and (v_central or rc.location_id = v_location)
          and i.product_id = pl.product_id), 0) - coalesce((
        select sum(b.quantity) from public.partner_backorders b
        where b.partner_id = p_partner_id and b.product_id = pl.product_id and b.status in ('open', 'shelved')
          and (v_central or b.location_id = v_location)), 0) as needed
    from jsonb_array_elements(p_counts) c
    join public.partner_par_levels pl on pl.partner_id = p_partner_id and pl.product_id = (c->>'product_id')::uuid
      and (case when v_central then pl.location_id is null else pl.location_id = v_location end)
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
  return private.cart_add_items(p_partner_id, v_items, 'app', v_location);
end
$$;

create function private.submit_refill_counts(p_counts jsonb, p_location_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare v_partner_id uuid;
begin
  select id into v_partner_id from public.partners where auth_user_id = (select auth.uid()) and active;
  if v_partner_id is null then raise exception 'Access denied' using errcode = '42501'; end if;
  return private.refill_counts_for(v_partner_id, p_counts, p_location_id);
end
$$;

create function private.submit_refill_counts_for(p_partner_id uuid, p_counts jsonb, p_location_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not private.can_manage_partner(p_partner_id) then raise exception 'Access denied' using errcode = '42501'; end if;
  return private.refill_counts_for(p_partner_id, p_counts, p_location_id);
end
$$;

-- Par level of a product, for the firm (central) or one point.
drop function if exists public.set_partner_par_level(uuid, uuid, integer);
drop function if exists private.set_partner_par_level(uuid, uuid, integer);
create function private.set_partner_par_level(p_partner_id uuid, p_product_id uuid, p_quantity integer, p_location_id uuid default null)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare v_location uuid;
begin
  if not private.can_manage_partner(p_partner_id) or p_quantity is null or p_quantity < 0 or p_quantity > 100000 then return false; end if;
  if (select stock_mode from public.partners where id = p_partner_id) = 'per_location' then
    select id into v_location from public.partner_locations where id = p_location_id and partner_id = p_partner_id and active;
    if v_location is null then return false; end if;
  end if;
  if p_quantity = 0 then
    delete from public.partner_par_levels where partner_id = p_partner_id and product_id = p_product_id and location_id is not distinct from v_location;
    return true;
  end if;
  perform 1 from public.products where id = p_product_id and active;
  if not found then return false; end if;
  insert into public.partner_par_levels (partner_id, location_id, product_id, par_level_quantity, set_by)
    values (p_partner_id, v_location, p_product_id, p_quantity, (select auth.uid()))
    on conflict (partner_id, location_id, product_id) do update set par_level_quantity = excluded.par_level_quantity,
      set_by = excluded.set_by, updated_at = now();
  return true;
end
$$;

-- Points of work: add or edit (agent of the client, admin).
create or replace function private.save_partner_location(p_partner_id uuid, p_location_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare v_id uuid;
begin
  if not private.can_manage_partner(p_partner_id) then raise exception 'Access denied' using errcode = '42501'; end if;
  if nullif(trim(p_data->>'name'), '') is null then raise exception 'Name required' using errcode = '22023'; end if;
  if p_location_id is null then
    insert into public.partner_locations (partner_id, name, city, address, contact_name, contact_phone)
      values (p_partner_id, left(trim(p_data->>'name'), 120), nullif(left(trim(p_data->>'city'), 120), ''), nullif(left(trim(p_data->>'address'), 300), ''),
        nullif(left(trim(p_data->>'contact_name'), 120), ''), nullif(left(trim(p_data->>'contact_phone'), 40), ''))
      returning id into v_id;
  else
    update public.partner_locations set name = left(trim(p_data->>'name'), 120), city = nullif(left(trim(p_data->>'city'), 120), ''),
        address = nullif(left(trim(p_data->>'address'), 300), ''), contact_name = nullif(left(trim(p_data->>'contact_name'), 120), ''),
        contact_phone = nullif(left(trim(p_data->>'contact_phone'), 40), ''),
        active = coalesce((p_data->>'active')::boolean, active) or is_main
      where id = p_location_id and partner_id = p_partner_id returning id into v_id;
  end if;
  return v_id;
end
$$;

-- Switching the stock mode moves the par levels: central ↔ the main point.
create or replace function private.set_partner_stock_mode(p_partner_id uuid, p_mode text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare v_main uuid;
begin
  if not private.can_manage_partner(p_partner_id) then raise exception 'Access denied' using errcode = '42501'; end if;
  if p_mode not in ('central', 'per_location') then raise exception 'Invalid mode' using errcode = '22023'; end if;
  select id into v_main from public.partner_locations where partner_id = p_partner_id and is_main;
  if (select stock_mode from public.partners where id = p_partner_id) = p_mode then return true; end if;
  if p_mode = 'per_location' then
    update public.partner_par_levels set location_id = v_main where partner_id = p_partner_id and location_id is null;
  else
    delete from public.partner_par_levels where partner_id = p_partner_id and location_id is not null and location_id <> v_main;
    update public.partner_par_levels set location_id = null where partner_id = p_partner_id and location_id = v_main;
  end if;
  update public.partners set stock_mode = p_mode where id = p_partner_id;
  return true;
end
$$;

-- Backorders remember the point; shelved ones leave with the next delivery to the same point.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname = 'prepare_partner_cart';
  if position('select c.id, c.partner_id, p.business_name, p.account_id into v_cart' in v_def) = 0 then raise exception 'prepare changed'; end if;
  v_def := replace(v_def, 'select c.id, c.partner_id, p.business_name, p.account_id into v_cart', 'select c.id, c.partner_id, c.location_id, p.business_name, p.account_id into v_cart');
  v_def := replace(v_def, 'insert into public.partner_backorders (partner_id, product_id, quantity, source_cart_id, created_by)
      values (v_cart.partner_id, v_item.product_id, v_short, p_cart_id, (select auth.uid()));',
    'insert into public.partner_backorders (partner_id, location_id, product_id, quantity, source_cart_id, created_by)
      values (v_cart.partner_id, v_cart.location_id, v_item.product_id, v_short, p_cart_id, (select auth.uid()));');
  v_def := replace(v_def, $x$where partner_id = v_cart.partner_id and status = 'shelved' for update loop$x$,
    $x$where partner_id = v_cart.partner_id and status = 'shelved' and location_id is not distinct from v_cart.location_id for update loop$x$);
  if position('v_cart.location_id, v_item.product_id' in v_def) = 0 or position('location_id is not distinct from v_cart.location_id for update' in v_def) = 0 then
    raise exception 'prepare not patched';
  end if;
  execute v_def;

  select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname = 'shelve_backorder';
  v_def := replace(v_def, 'insert into public.partner_backorders (partner_id, product_id, quantity, status, source_cart_id, created_by, created_at, shelved_at, shelved_by)
      values (v_back.partner_id, v_back.product_id,',
    'insert into public.partner_backorders (partner_id, location_id, product_id, quantity, status, source_cart_id, created_by, created_at, shelved_at, shelved_by)
      values (v_back.partner_id, v_back.location_id, v_back.product_id,');
  if position('v_back.location_id, v_back.product_id' in v_def) = 0 then raise exception 'shelve not patched'; end if;
  execute v_def;
end
$$;

-- Invoker wrappers.
create function public.staff_add_refill(p_partner_id uuid, p_items jsonb, p_source text, p_location_id uuid default null) returns jsonb
  language sql security invoker set search_path to '' as $$ select private.staff_add_refill(p_partner_id, p_items, p_source, p_location_id) $$;
create function public.submit_refill_counts(p_counts jsonb, p_location_id uuid default null) returns jsonb
  language sql security invoker set search_path to '' as $$ select private.submit_refill_counts(p_counts, p_location_id) $$;
create function public.submit_refill_counts_for(p_partner_id uuid, p_counts jsonb, p_location_id uuid default null) returns jsonb
  language sql security invoker set search_path to '' as $$ select private.submit_refill_counts_for(p_partner_id, p_counts, p_location_id) $$;
create function public.set_partner_par_level(p_partner_id uuid, p_product_id uuid, p_quantity integer, p_location_id uuid default null) returns boolean
  language sql security invoker set search_path to '' as $$ select private.set_partner_par_level(p_partner_id, p_product_id, p_quantity, p_location_id) $$;
create function public.save_partner_location(p_partner_id uuid, p_location_id uuid, p_data jsonb) returns uuid
  language sql security invoker set search_path to '' as $$ select private.save_partner_location(p_partner_id, p_location_id, p_data) $$;
create function public.set_partner_stock_mode(p_partner_id uuid, p_mode text) returns boolean
  language sql security invoker set search_path to '' as $$ select private.set_partner_stock_mode(p_partner_id, p_mode) $$;

revoke all on function private.create_main_location(), private.order_location(uuid, uuid), private.cart_add_items(uuid, jsonb, text, uuid),
  private.staff_add_refill(uuid, jsonb, text, uuid), private.refill_counts_for(uuid, jsonb, uuid), private.submit_refill_counts(jsonb, uuid),
  private.submit_refill_counts_for(uuid, jsonb, uuid), private.set_partner_par_level(uuid, uuid, integer, uuid),
  private.save_partner_location(uuid, uuid, jsonb), private.set_partner_stock_mode(uuid, text),
  public.staff_add_refill(uuid, jsonb, text, uuid), public.submit_refill_counts(jsonb, uuid), public.submit_refill_counts_for(uuid, jsonb, uuid),
  public.set_partner_par_level(uuid, uuid, integer, uuid), public.save_partner_location(uuid, uuid, jsonb), public.set_partner_stock_mode(uuid, text)
  from public, anon;
grant execute on function private.order_location(uuid, uuid), private.staff_add_refill(uuid, jsonb, text, uuid), private.submit_refill_counts(jsonb, uuid),
  private.submit_refill_counts_for(uuid, jsonb, uuid), private.set_partner_par_level(uuid, uuid, integer, uuid),
  private.save_partner_location(uuid, uuid, jsonb), private.set_partner_stock_mode(uuid, text),
  public.staff_add_refill(uuid, jsonb, text, uuid), public.submit_refill_counts(jsonb, uuid), public.submit_refill_counts_for(uuid, jsonb, uuid),
  public.set_partner_par_level(uuid, uuid, integer, uuid), public.save_partner_location(uuid, uuid, jsonb), public.set_partner_stock_mode(uuid, text)
  to authenticated;
