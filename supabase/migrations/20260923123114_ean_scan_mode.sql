-- Per-product switch from temporary SKU confirmation to physical EAN scanning.
-- A trigger on order items keeps the BOCP import untouched (and the pending
-- scheduled-import migration valid): it learns EANs and applies the product's mode.

alter table public.products
  add column scan_mode text not null default 'sku' check (scan_mode in ('sku', 'ean')),
  add constraint products_ean_format check (ean is null or ean ~ '^\d{8,14}$'),
  add constraint products_ean_mode_requires_ean check (scan_mode = 'sku' or ean is not null);

create function private.apply_item_scan_mode() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_product public.products%rowtype;
begin
  -- Learn the barcode BOCP sent for this product, unless another product already owns it.
  if new.ean ~ '^\d{8,14}$' then
    begin
      update public.products set ean = new.ean where id = new.product_id and ean is null;
    exception when unique_violation then null;
    end;
  end if;
  select * into v_product from public.products where id = new.product_id;
  if v_product.scan_mode = 'ean' and v_product.ean is not null then
    new.ean := v_product.ean;
    new.scan_code := v_product.ean;
    new.scan_code_type := 'ean';
  end if;
  return new;
end
$$;
revoke all on function private.apply_item_scan_mode() from public, anon, authenticated;

create trigger online_order_items_scan_mode before insert on public.online_order_items
  for each row execute function private.apply_item_scan_mode();

-- Items of orders nobody has started yet follow the product's current mode.
create function private.resync_pending_items(p_product_id uuid) returns void
language sql security definer set search_path = ''
as $$
  update public.online_order_items i
  set scan_code = case when p.scan_mode = 'ean' then p.ean else p.sku end,
      scan_code_type = p.scan_mode,
      ean = coalesce(p.ean, i.ean)
  from public.products p, public.online_orders o
  where p.id = p_product_id and i.product_id = p.id and o.id = i.order_id
    and o.status = 'pending' and i.scanned_quantity = 0
$$;
revoke all on function private.resync_pending_items(uuid) from public, anon, authenticated;

create function private.set_product_ean(p_product_id uuid, p_ean text) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_ean text := nullif(regexp_replace(coalesce(p_ean, ''), '\s', '', 'g'), '');
begin
  if (select auth.uid()) is null or coalesce((select private.current_role()) <> 'admin', true) then return 'denied'; end if;
  if v_ean is not null and v_ean !~ '^\d{8,14}$' then return 'invalid'; end if;
  if v_ean is not null and exists (select 1 from public.products where ean = v_ean and id <> p_product_id) then
    return 'duplicate';
  end if;
  -- Removing the EAN also returns the product to SKU confirmation.
  update public.products set ean = v_ean, scan_mode = case when v_ean is null then 'sku' else scan_mode end
    where id = p_product_id;
  if not found then return 'not_found'; end if;
  perform private.resync_pending_items(p_product_id);
  return 'saved';
end
$$;

create function private.set_product_scan_mode(p_product_id uuid, p_mode text) returns text
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or coalesce((select private.current_role()) <> 'admin', true) then return 'denied'; end if;
  if p_mode not in ('sku', 'ean') then return 'invalid'; end if;
  update public.products set scan_mode = p_mode
    where id = p_product_id and (p_mode = 'sku' or ean is not null);
  if not found then return 'needs_ean'; end if;
  perform private.resync_pending_items(p_product_id);
  return 'saved';
end
$$;

create function private.enable_ean_for_all() returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_count integer := 0;
begin
  if (select auth.uid()) is null or coalesce((select private.current_role()) <> 'admin', true) then return 0; end if;
  for v_id in update public.products set scan_mode = 'ean'
      where ean is not null and scan_mode = 'sku' returning id loop
    perform private.resync_pending_items(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

revoke all on function private.set_product_ean(uuid, text) from public, anon;
revoke all on function private.set_product_scan_mode(uuid, text) from public, anon;
revoke all on function private.enable_ean_for_all() from public, anon;
grant execute on function private.set_product_ean(uuid, text) to authenticated;
grant execute on function private.set_product_scan_mode(uuid, text) to authenticated;
grant execute on function private.enable_ean_for_all() to authenticated;

create function public.set_product_ean(p_product_id uuid, p_ean text) returns text
language sql security invoker set search_path = '' as $$ select private.set_product_ean(p_product_id, p_ean) $$;
create function public.set_product_scan_mode(p_product_id uuid, p_mode text) returns text
language sql security invoker set search_path = '' as $$ select private.set_product_scan_mode(p_product_id, p_mode) $$;
create function public.enable_ean_for_all() returns integer
language sql security invoker set search_path = '' as $$ select private.enable_ean_for_all() $$;
