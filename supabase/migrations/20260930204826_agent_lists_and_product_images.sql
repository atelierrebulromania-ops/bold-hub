-- The client directory lists each client's delivery groups; agents get a list of their clients'
-- invoices; the catalog sync keeps the product picture from BOCP.

drop function public.partner_directory();
drop function private.partner_directory();
create function private.partner_directory()
returns table(id uuid, business_name text, location_name text, type text, active boolean, account_id uuid, account_name text, delivery_groups text[])
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not private.is_staff(array['admin', 'account', 'operator_depozit', 'operator_facturare']::public.user_role[]) then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  return query
    select p.id, p.business_name, p.location_name, p.type, p.active, p.account_id, u.full_name,
      coalesce((select array_agg(g.name order by g.name) from public.partner_delivery_groups pg
        join public.delivery_groups g on g.id = pg.delivery_group_id where pg.partner_id = p.id), '{}')
    from public.partners p left join public.app_users u on u.id = p.account_id
    order by p.business_name;
end
$$;
create function public.partner_directory()
returns table(id uuid, business_name text, location_name text, type text, active boolean, account_id uuid, account_name text, delivery_groups text[])
language sql stable security invoker set search_path = '' as $$ select * from private.partner_directory() $$;

-- Invoices of an agent's clients: B2B carts and proformas invoiced directly (the admin sees all).
create function private.account_invoices()
returns table(source text, id uuid, partner_name text, invoice_number text, invoice_date date, due_date date,
  total numeric, rest numeric, invoiced_at timestamptz, proforma_number text)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_admin boolean := coalesce((select private.current_role()) = 'admin', false);
begin
  if not private.is_staff(array['admin', 'account']::public.user_role[]) then return; end if;
  return query
    select 'cart'::text, c.id, p.business_name, c.invoice_number, c.invoice_date, c.invoice_due_date, c.invoice_total, c.invoice_rest,
        c.invoiced_at, d.number
      from public.partner_carts c join public.partners p on p.id = c.partner_id
      left join public.sales_documents d on d.id = c.source_document_id
      where c.invoiced_at is not null and c.bocp_invoice_id is not null and (v_admin or p.account_id = (select auth.uid()))
    union all
    select 'document'::text, d.id, coalesce(p.business_name, d.client_name), d.invoice_number, d.invoice_date, d.invoice_due_date,
        d.invoice_total, d.invoice_rest, d.invoiced_at, d.number
      from public.sales_documents d left join public.partners p on p.id = d.partner_id
      where d.invoiced_at is not null and d.bocp_invoice_id is not null and (v_admin or d.account_id = (select auth.uid()))
    order by 9 desc
    limit 500;
end
$$;
create function public.account_invoices()
returns table(source text, id uuid, partner_name text, invoice_number text, invoice_date date, due_date date,
  total numeric, rest numeric, invoiced_at timestamptz, proforma_number text)
language sql stable security invoker set search_path = '' as $$ select * from private.account_invoices() $$;

do $$
declare f text;
begin
  foreach f in array array['private.partner_directory()', 'public.partner_directory()', 'private.account_invoices()', 'public.account_invoices()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Catalog sync: also the product's picture (BOCP CDN only).
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
      vat_percent = case when (v_item->>'vatPercent') ~ v_amount and (v_item->>'vatPercent')::numeric <= 100 then (v_item->>'vatPercent')::numeric else vat_percent end,
      image_url = case when (v_item->>'imageUrl') ~ '^https://cdn\.bocp\.eu/' and length(v_item->>'imageUrl') <= 1000 then v_item->>'imageUrl' else image_url end
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
