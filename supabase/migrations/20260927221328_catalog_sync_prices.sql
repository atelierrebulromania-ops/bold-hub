-- The BOCP catalog sync also keeps the list price, VAT and category (used by agents' offers and discounts).
create or replace function private.sync_bocp_catalog(p_products jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
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
  v_amount text := '^\d{1,9}(\.\d{1,4})?$';
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

    update public.products set
      category = coalesce(left(nullif(trim(v_item->>'category'), ''), 120), category),
      list_price = case when (v_item->>'price') ~ v_amount then round((v_item->>'price')::numeric, 2) else list_price end,
      list_price_with_vat = case when (v_item->>'priceWithVat') ~ v_amount then round((v_item->>'priceWithVat')::numeric, 2) else list_price_with_vat end,
      vat_percent = case when (v_item->>'vatPercent') ~ v_amount and (v_item->>'vatPercent')::numeric <= 100 then (v_item->>'vatPercent')::numeric else vat_percent end
    where id = v_product.id;

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
