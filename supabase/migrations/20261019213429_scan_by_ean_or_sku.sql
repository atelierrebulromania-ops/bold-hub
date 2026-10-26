-- Confirming a product in an online order: the scanned barcode (EAN) or the SKU typed by hand both
-- find the line, whichever code the order was imported with. EAN leading zeros are ignored
-- (a scanner may read EAN-13 as UPC-12 or the other way round).
CREATE OR REPLACE FUNCTION private.scan_online_order_code(p_order_id uuid, p_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_item_id uuid;
  v_code text := upper(trim(p_code));
  v_digits text := case when trim(p_code) ~ '^\d{6,14}$' then ltrim(trim(p_code), '0') end;
begin
  if (select auth.uid()) is null or (select private.current_role()) not in ('admin', 'operator_depozit') then
    return false;
  end if;
  if nullif(v_code, '') is null then return false; end if;
  perform 1 from public.online_orders
    where id = p_order_id and claimed_by = (select auth.uid()) and status in ('claimed', 'preparing')
    for update;
  if not found then return false; end if;
  select i.id into v_item_id from public.online_order_items i
    left join public.products p on p.id = i.product_id
    where i.order_id = p_order_id
      and i.scanned_quantity < i.quantity
      and (upper(i.scan_code) = v_code or upper(p.sku) = v_code
        or (v_digits <> '' and (ltrim(i.ean, '0') = v_digits or ltrim(p.ean, '0') = v_digits)))
    order by i.created_at, i.id limit 1 for update of i;
  if v_item_id is null then return false; end if;
  update public.online_orders set status = 'preparing' where id = p_order_id;
  update public.online_order_items set scanned_quantity = scanned_quantity + 1 where id = v_item_id;
  return found;
end
$function$;
