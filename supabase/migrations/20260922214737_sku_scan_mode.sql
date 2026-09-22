-- Temporary SKU confirmation while physical EAN labels are prepared.
-- Keep EAN as a nullable snapshot so each item can later opt into EAN scanning.
alter table public.online_order_items alter column ean drop not null;
alter table public.online_order_items add column scan_code text;
update public.online_order_items i
set scan_code = coalesce(nullif(trim(i.ean), ''), p.sku)
from public.products p
where p.id = i.product_id;
alter table public.online_order_items alter column scan_code set not null;
alter table public.online_order_items
  add constraint online_order_item_scan_code_not_blank check (length(trim(scan_code)) > 0);
alter table public.online_order_items
  add column scan_code_type text not null default 'sku'
  check (scan_code_type in ('sku', 'ean'));
update public.online_order_items set scan_code_type = 'ean'
where ean is not null and scan_code = ean;

drop function public.scan_online_order_item(uuid, text);
drop function private.scan_online_order_item(uuid, text);

create function private.scan_online_order_code(p_order_id uuid, p_code text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_item_id uuid;
begin
  if (select auth.uid()) is null or (select private.current_role()) not in ('admin', 'operator_depozit') then
    return false;
  end if;
  if nullif(trim(p_code), '') is null then return false; end if;
  perform 1 from public.online_orders
    where id = p_order_id and claimed_by = (select auth.uid()) and status in ('claimed', 'preparing')
    for update;
  if not found then return false; end if;
  select i.id into v_item_id from public.online_order_items i
    where i.order_id = p_order_id
      and upper(i.scan_code) = upper(trim(p_code))
      and i.scanned_quantity < i.quantity
    order by i.created_at, i.id limit 1 for update;
  if v_item_id is null then return false; end if;
  update public.online_orders set status = 'preparing' where id = p_order_id;
  update public.online_order_items set scanned_quantity = scanned_quantity + 1 where id = v_item_id;
  return found;
end
$$;

revoke all on function private.scan_online_order_code(uuid, text) from public, anon;
grant execute on function private.scan_online_order_code(uuid, text) to authenticated;

create function public.scan_online_order_code(p_order_id uuid, p_code text) returns boolean
language sql security invoker set search_path = ''
as $$ select private.scan_online_order_code(p_order_id, p_code) $$;
revoke all on function public.scan_online_order_code(uuid, text) from public, anon;
grant execute on function public.scan_online_order_code(uuid, text) to authenticated;
