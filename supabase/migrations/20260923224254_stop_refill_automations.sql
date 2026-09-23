-- Delivery and billing are decided manually on the partners screen. The old automations
-- that moved carts into proposed deliveries (important client, 48h countdown) are removed;
-- the 48h timer stays a display only. A priority partner's request is flagged at once.
select cron.unschedule('refill-countdown-48h');
drop function public.run_refill_countdowns();
drop function private.run_refill_countdowns();
drop function private.process_refill_countdowns();

create or replace function private.cart_add_items(p_partner_id uuid, p_items jsonb, p_source text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_partner public.partners%rowtype;
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

  select id into v_cart_id from public.partner_carts where partner_id = p_partner_id and status = 'open';
  if v_cart_id is null then
    insert into public.partner_carts (partner_id) values (p_partner_id) returning id into v_cart_id;
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
      'Client prioritar: ' || v_partner.business_name || ' — livrare imediată, ' || v_units || ' buc. de pregătit.',
      'partner_cart', v_cart_id);
  else
    perform private.notify('operator_depozit', 'refill_nou',
      'Refill nou: ' || v_partner.business_name || ' — ' || v_units || ' buc. de pus pe raftul rezervat.',
      'partner_cart', v_cart_id);
  end if;

  return jsonb_build_object('cart_id', v_cart_id, 'items', v_added, 'units', v_units);
end
$$;
