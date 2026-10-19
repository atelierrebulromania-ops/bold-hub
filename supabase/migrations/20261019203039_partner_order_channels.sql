-- Order channels: a partner can order for resale (products on the shelf for its customers) and for its
-- own consumption (e.g. a hotel using our products). Each channel has its own initial stock; both channels
-- travel in the same order (cart) and go on the same invoice.

alter table public.partner_par_levels add column channel text not null default 'resale'
  constraint partner_par_levels_channel_check check (channel in ('resale', 'consumption'));
alter table public.partner_cart_items add column channel text not null default 'resale'
  constraint partner_cart_items_channel_check check (channel in ('resale', 'consumption'));
alter table public.partner_backorders add column channel text not null default 'resale'
  constraint partner_backorders_channel_check check (channel in ('resale', 'consumption'));

alter table public.partner_par_levels drop constraint partner_par_levels_unique;
alter table public.partner_par_levels add constraint partner_par_levels_unique
  unique nulls not distinct (partner_id, location_id, channel, product_id);

-- Items may carry "channel" (default resale).
CREATE OR REPLACE FUNCTION private.cart_add_items(p_partner_id uuid, p_items jsonb, p_source text, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_channel text;
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
    v_channel := coalesce(v_item->>'channel', 'resale');
    if v_quantity is null or v_quantity < 1 or v_quantity > 100000 then
      raise exception 'Invalid quantity' using errcode = '22023';
    end if;
    if v_channel not in ('resale', 'consumption') then
      raise exception 'Invalid channel' using errcode = '22023';
    end if;
    perform 1 from public.products where id = v_product and active;
    if not found then raise exception 'Unknown product' using errcode = '22023'; end if;

    insert into public.refill_requests (partner_id, source, phone_number, quantity, status, confirmed_at)
      values (p_partner_id, p_source, case when p_source = 'whatsapp' then v_partner.contact_phone end,
        v_quantity, 'confirmed', now())
      returning id into v_request_id;
    insert into public.partner_cart_items (cart_id, product_id, quantity_needed, refill_request_id, channel)
      values (v_cart_id, v_product, v_quantity, v_request_id, v_channel) returning id into v_cart_item_id;
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
$function$;

-- Counts may carry "channel" (default resale): each channel is compared with its own initial stock and
-- only what is already ordered or owed on the same channel is subtracted.
CREATE OR REPLACE FUNCTION private.refill_counts_for(p_partner_id uuid, p_counts jsonb, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    select pl.product_id, pl.channel,
      pl.par_level_quantity - greatest(0, (c->>'remaining')::integer) - coalesce((
        select sum(i.quantity_needed) from public.partner_cart_items i
        join public.partner_carts rc on rc.id = i.cart_id
        where rc.partner_id = p_partner_id and rc.status::text in ('open', 'prepared', 'pending_delivery')
          and (v_central or rc.location_id = v_location)
          and i.product_id = pl.product_id and i.channel = pl.channel), 0) - coalesce((
        select sum(b.quantity) from public.partner_backorders b
        where b.partner_id = p_partner_id and b.product_id = pl.product_id and b.channel = pl.channel and b.status in ('open', 'shelved')
          and (v_central or b.location_id = v_location)), 0) as needed
    from jsonb_array_elements(p_counts) c
    join public.partner_par_levels pl on pl.partner_id = p_partner_id and pl.product_id = (c->>'product_id')::uuid
      and pl.channel = coalesce(c->>'channel', 'resale')
      and (case when v_central then pl.location_id is null else pl.location_id = v_location end)
    join public.products p on p.id = pl.product_id and p.active
    where (c->>'remaining') ~ '^\d{1,6}$'
  loop
    if v_row.needed > 0 then
      v_items := v_items || jsonb_build_object('product_id', v_row.product_id, 'quantity', v_row.needed, 'channel', v_row.channel);
    end if;
  end loop;

  if jsonb_array_length(v_items) = 0 then
    return jsonb_build_object('items', 0, 'units', 0);
  end if;
  return private.cart_add_items(p_partner_id, v_items, 'app', v_location);
end
$function$;

-- A short line becomes a backorder on the same channel; shelved backorders join the cart on their channel.
CREATE OR REPLACE FUNCTION private.prepare_partner_cart(p_cart_id uuid, p_lines jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cart record;
  v_item record;
  v_qty integer;
  v_short integer;
  v_shorts text := '';
  v_back record;
begin
  if not private.is_staff(array['admin', 'operator_depozit']::public.user_role[]) then
    raise exception 'Warehouse access required' using errcode = '42501';
  end if;
  select c.id, c.partner_id, c.location_id, p.business_name, p.account_id into v_cart
    from public.partner_carts c join public.partners p on p.id = c.partner_id
    where c.id = p_cart_id and c.status = 'open' for update of c;
  if not found then return 'changed'; end if;

  for v_item in select i.id, i.product_id, i.channel, i.quantity_needed, pr.name, pr.variant_label
      from public.partner_cart_items i join public.products pr on pr.id = i.product_id where i.cart_id = p_cart_id for update of i loop
    select (l->>'quantity')::integer into v_qty from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
      where l->>'item_id' = v_item.id::text and (l->>'quantity') ~ '^\d{1,6}$';
    v_qty := least(coalesce(v_qty, v_item.quantity_needed), v_item.quantity_needed);
    v_short := v_item.quantity_needed - v_qty;
    continue when v_short = 0;
    insert into public.partner_backorders (partner_id, location_id, product_id, channel, quantity, source_cart_id, created_by)
      values (v_cart.partner_id, v_cart.location_id, v_item.product_id, v_item.channel, v_short, p_cart_id, (select auth.uid()));
    update public.warehouse_stock set quantity_reserved = greatest(0, quantity_reserved - v_short), updated_at = now()
      where product_id = v_item.product_id;
    if v_qty = 0 then
      update public.refill_requests set cart_item_id = null where cart_item_id = v_item.id;
      delete from public.partner_cart_items where id = v_item.id;
    else
      update public.partner_cart_items set quantity_needed = v_qty where id = v_item.id;
    end if;
    v_shorts := v_shorts || case when v_shorts = '' then '' else '; ' end
      || v_item.name || coalesce(' · ' || v_item.variant_label, '') || ' ×' || v_short;
  end loop;

  for v_back in select id, product_id, channel, quantity from public.partner_backorders
      where partner_id = v_cart.partner_id and status = 'shelved' and location_id is not distinct from v_cart.location_id for update loop
    update public.partner_cart_items set quantity_needed = quantity_needed + v_back.quantity
      where cart_id = p_cart_id and product_id = v_back.product_id and channel = v_back.channel;
    if not found then
      insert into public.partner_cart_items (cart_id, product_id, channel, quantity_needed) values (p_cart_id, v_back.product_id, v_back.channel, v_back.quantity);
    end if;
    update public.partner_backorders set status = 'delivered', delivered_cart_id = p_cart_id where id = v_back.id;
  end loop;

  if v_shorts <> '' and v_cart.account_id is not null then
    insert into public.notifications (recipient_user_id, type, message, related_entity_type, related_entity_id)
      values (v_cart.account_id, 'restanta_noua', left('Restanță la ' || v_cart.business_name || ': ' || v_shorts || '. Pleacă la următoarea livrare, când revine stocul.', 500), 'partner_cart', p_cart_id);
  end if;

  if not exists (select 1 from public.partner_cart_items where cart_id = p_cart_id) then
    update public.partner_carts set countdown_started_at = null where id = p_cart_id;
    return 'empty';
  end if;
  update public.partner_carts set status = 'prepared', prepared_at = now(), prepared_by = (select auth.uid()) where id = p_cart_id;
  return 'prepared';
end
$function$;

CREATE OR REPLACE FUNCTION private.shelve_backorder(p_id uuid, p_quantity integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_back record;
begin
  if not private.is_staff(array['admin', 'operator_depozit']::public.user_role[]) then
    raise exception 'Warehouse access required' using errcode = '42501';
  end if;
  select * into v_back from public.partner_backorders where id = p_id and status = 'open' for update;
  if not found or p_quantity is null or p_quantity < 1 or p_quantity > v_back.quantity then return false; end if;
  if p_quantity < v_back.quantity then
    update public.partner_backorders set quantity = quantity - p_quantity where id = p_id;
    insert into public.partner_backorders (partner_id, location_id, product_id, channel, quantity, status, source_cart_id, created_by, created_at, shelved_at, shelved_by)
      values (v_back.partner_id, v_back.location_id, v_back.product_id, v_back.channel, p_quantity, 'shelved', v_back.source_cart_id, v_back.created_by, v_back.created_at, now(), (select auth.uid()));
  else
    update public.partner_backorders set status = 'shelved', shelved_at = now(), shelved_by = (select auth.uid()) where id = p_id;
  end if;
  insert into public.warehouse_stock (product_id, quantity_reserved) values (v_back.product_id, p_quantity)
    on conflict (product_id) do update set quantity_reserved = public.warehouse_stock.quantity_reserved + excluded.quantity_reserved, updated_at = now();
  return true;
end
$function$;

-- Initial stock per channel.
drop function public.set_partner_par_level(uuid, uuid, integer, uuid);
drop function private.set_partner_par_level(uuid, uuid, integer, uuid);

CREATE FUNCTION private.set_partner_par_level(p_partner_id uuid, p_product_id uuid, p_quantity integer, p_location_id uuid DEFAULT NULL::uuid, p_channel text DEFAULT 'resale')
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_location uuid;
begin
  if not private.can_manage_partner(p_partner_id) or p_quantity is null or p_quantity < 0 or p_quantity > 100000
    or p_channel is null or p_channel not in ('resale', 'consumption') then return false; end if;
  if (select stock_mode from public.partners where id = p_partner_id) = 'per_location' then
    select id into v_location from public.partner_locations where id = p_location_id and partner_id = p_partner_id and active;
    if v_location is null then return false; end if;
  end if;
  if p_quantity = 0 then
    delete from public.partner_par_levels where partner_id = p_partner_id and product_id = p_product_id
      and location_id is not distinct from v_location and channel = p_channel;
    return true;
  end if;
  perform 1 from public.products where id = p_product_id and active;
  if not found then return false; end if;
  insert into public.partner_par_levels (partner_id, location_id, channel, product_id, par_level_quantity, set_by)
    values (p_partner_id, v_location, p_channel, p_product_id, p_quantity, (select auth.uid()))
    on conflict (partner_id, location_id, channel, product_id) do update set par_level_quantity = excluded.par_level_quantity,
      set_by = excluded.set_by, updated_at = now();
  return true;
end
$function$;
revoke all on function private.set_partner_par_level(uuid, uuid, integer, uuid, text) from public, anon;
grant execute on function private.set_partner_par_level(uuid, uuid, integer, uuid, text) to authenticated;

CREATE FUNCTION public.set_partner_par_level(p_partner_id uuid, p_product_id uuid, p_quantity integer, p_location_id uuid DEFAULT NULL::uuid, p_channel text DEFAULT 'resale')
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select private.set_partner_par_level(p_partner_id, p_product_id, p_quantity, p_location_id, p_channel) $function$;
revoke all on function public.set_partner_par_level(uuid, uuid, integer, uuid, text) from public, anon;
grant execute on function public.set_partner_par_level(uuid, uuid, integer, uuid, text) to service_role;
grant execute on function public.set_partner_par_level(uuid, uuid, integer, uuid, text) to authenticated;
