-- Admin-triggered sync of the BOCP catalog (product/list): creates products by SKU, fills the
-- scanning EAN from BOCP "Cod bare" and records the last known BOCP stock. Never clears an EAN
-- and never touches bocp_product_id, which the invoice import owns (variant IDs).

create function private.sync_bocp_catalog(p_products jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_item jsonb;
  v_sku text;
  v_name text;
  v_ean text;
  v_stock integer;
  v_product record;
  v_created integer := 0;
  v_updated integer := 0;
  v_ean_set integer := 0;
  v_stock_set integer := 0;
  v_conflicts jsonb := '[]'::jsonb;
begin
  if (select auth.uid()) is null or coalesce((select private.current_role()) <> 'admin', true) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_products) is distinct from 'array' or jsonb_array_length(p_products) > 500 then
    raise exception 'Expected at most 500 products' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_products) loop
    v_sku := nullif(trim(v_item->>'sku'), '');
    v_name := nullif(trim(v_item->>'name'), '');
    v_ean := nullif(trim(v_item->>'ean'), '');
    v_stock := case when (v_item->>'stock') ~ '^\d{1,9}$' then (v_item->>'stock')::integer end;
    if v_sku is null or length(v_sku) > 100 or length(coalesce(v_name, '')) > 300
      or (v_ean is not null and v_ean !~ '^\d{8,14}$') then
      raise exception 'Invalid catalog item' using errcode = '22023';
    end if;

    insert into public.products (sku, name, synced_at) values (v_sku, coalesce(v_name, v_sku), now())
      on conflict (sku) do update set name = excluded.name, synced_at = now()
      returning id, ean, (xmax = 0) as inserted into v_product;
    if v_product.inserted then v_created := v_created + 1; else v_updated := v_updated + 1; end if;

    if v_ean is not null and v_product.ean is distinct from v_ean then
      if exists (select 1 from public.products where ean = v_ean and id <> v_product.id) then
        v_conflicts := v_conflicts || jsonb_build_object('sku', v_sku, 'ean', v_ean);
      else
        update public.products set ean = v_ean where id = v_product.id;
        perform private.resync_pending_items(v_product.id);
        v_ean_set := v_ean_set + 1;
      end if;
    end if;

    if v_stock is not null then
      insert into public.warehouse_stock (product_id, quantity_bocp_global) values (v_product.id, v_stock)
        on conflict (product_id) do update set quantity_bocp_global = excluded.quantity_bocp_global, updated_at = now();
      v_stock_set := v_stock_set + 1;
    end if;
  end loop;

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'eanSet', v_ean_set,
    'stockSet', v_stock_set, 'eanConflicts', v_conflicts);
end
$$;

revoke all on function private.sync_bocp_catalog(jsonb) from public, anon;
grant execute on function private.sync_bocp_catalog(jsonb) to authenticated;
create function public.sync_bocp_catalog(p_products jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.sync_bocp_catalog(p_products) $$;
