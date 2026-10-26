-- The client's regime (purchase / consignment) applies to its resale products only; own consumption is always bought.
-- A consignment client's cart is split when the warehouse hands it to billing: the resale lines stay on it (transfer
-- voucher to CONSIGNATIE), the consumption lines move to a new cart that is invoiced like any purchase.
alter table public.partner_carts add column if not exists regime text not null default 'purchase'
  check (regime in ('purchase', 'consignment'));

update public.partner_carts c set regime = 'consignment'
  from public.partners p
  where p.id = c.partner_id and p.sales_mode = 'consignment' and c.invoiced_at is null and c.status = 'delivered'
    and not exists (select 1 from public.partner_cart_items i where i.cart_id = c.id and i.channel = 'consumption');

create or replace function private.split_cart_by_regime() returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_mode text;
  v_resale boolean;
  v_consumption boolean;
  v_new uuid;
begin
  select sales_mode into v_mode from public.partners where id = new.partner_id;
  if v_mode is distinct from 'consignment' then return null; end if;
  v_resale := exists (select 1 from public.partner_cart_items where cart_id = new.id and channel = 'resale');
  v_consumption := exists (select 1 from public.partner_cart_items where cart_id = new.id and channel = 'consumption');
  if v_resale and v_consumption then
    -- The consumption part: same delivery, invoiced; it keeps the BOCP reservation (only consumption lines were reserved).
    insert into public.partner_carts (partner_id, location_id, status, regime, countdown_started_at, created_at, prepared_at, prepared_by,
        delivered_at, delivered_by, reserved_in_bocp_at, reserved_in_bocp_by, bocp_order_id, bocp_order_error, bocp_order_attempted_at, source_document_id)
      values (new.partner_id, new.location_id, new.status, 'purchase', new.countdown_started_at, new.created_at, new.prepared_at, new.prepared_by,
        new.delivered_at, new.delivered_by, new.reserved_in_bocp_at, new.reserved_in_bocp_by, new.bocp_order_id, new.bocp_order_error, new.bocp_order_attempted_at, new.source_document_id)
      returning id into v_new;
    update public.partner_cart_items set cart_id = v_new where cart_id = new.id and channel = 'consumption';
    update public.partner_carts set regime = 'consignment', reserved_in_bocp_at = null, reserved_in_bocp_by = null, bocp_order_id = null,
        bocp_order_error = null, bocp_order_attempted_at = null
      where id = new.id;
  elsif v_resale then
    update public.partner_carts set regime = 'consignment' where id = new.id;
  end if;
  return null;
end
$$;

drop trigger if exists partner_cart_split_by_regime on public.partner_carts;
create trigger partner_cart_split_by_regime after update of status on public.partner_carts
  for each row when (new.status = 'delivered' and old.status is distinct from 'delivered')
  execute function private.split_cart_by_regime();

-- Transfer vouchers: only consignment carts (by the cart's own regime, set at the handover).
do $$
declare v_def text := pg_get_functiondef('private.mark_partner_carts_transferred(uuid[], text)'::regprocedure);
begin
  if position($q$p.sales_mode = 'consignment'$q$ in v_def) = 0 then raise exception 'Unexpected definition of mark_partner_carts_transferred'; end if;
  execute replace(v_def, $q$p.sales_mode = 'consignment'$q$, $q$c.regime = 'consignment'$q$);
end $$;

-- Consignment sales count only deliveries that went on consignment (not earlier purchases of the same products).
do $$
declare v_def text := pg_get_functiondef('private.consignment_sales(uuid, timestamp with time zone)'::regprocedure);
begin
  if position($q$c.status = 'delivered' and c.delivered_at is not null and i.channel = 'resale'$q$ in v_def) = 0 then
    raise exception 'Unexpected definition of consignment_sales';
  end if;
  execute replace(v_def, $q$c.status = 'delivered' and c.delivered_at is not null and i.channel = 'resale'$q$,
    $q$c.status = 'delivered' and c.delivered_at is not null and i.channel = 'resale' and c.regime = 'consignment'$q$);
end $$;
