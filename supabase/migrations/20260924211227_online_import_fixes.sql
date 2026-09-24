-- Online-order import fixes found on the first real BOCP import:
--  * created_at takes the invoice's real issue time (BOCP record_ts, Bucharest), not midnight UTC;
--  * an invoice line fully cancelled by its own "Discount …" line is a gift: still picked, but flagged;
--  * invoice line names no longer overwrite the clean catalog product names;
--  * products without an EAN are confirmed with a checkbox instead of a scan.
alter table public.online_order_items add column is_gift boolean not null default false;

create or replace function private.import_bocp_online_orders(p_orders jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_order jsonb;
  v_item jsonb;
  v_order_id uuid;
  v_product_id uuid;
  v_invoice_number text;
  v_invoice_date text;
  v_issued_at text;
  v_invoice_id text;
  v_source text;
  v_sku text;
  v_bocp_product_id text;
  v_quantity_text text;
  v_pdf_url text;
  v_inserted integer := 0;
  v_existing integer := 0;
begin
  if (select auth.uid()) is null or (select private.current_role()) <> 'admin' then
    raise exception 'Administrator access required';
  end if;
  if jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) < 1
    or jsonb_array_length(p_orders) > 25 then
    raise exception 'Expected 1 to 25 BOCP orders';
  end if;

  for v_order in select value from pg_catalog.jsonb_array_elements(p_orders) loop
    v_invoice_number := nullif(trim(v_order->>'invoiceNumber'), '');
    v_invoice_date := v_order->>'invoiceDate';
    v_issued_at := v_order->>'invoiceIssuedAt';
    v_invoice_id := nullif(trim(v_order->>'bocpInvoiceId'), '');
    v_source := v_order->>'source';
    if v_invoice_number is null or length(v_invoice_number) > 100
      or v_invoice_date !~ '^\d{4}-\d{2}-\d{2}$'
      or pg_catalog.to_char(pg_catalog.to_date(v_invoice_date, 'YYYY-MM-DD'), 'YYYY-MM-DD') <> v_invoice_date
      or v_source not in ('shopify', 'marketplace')
      or jsonb_typeof(v_order->'items') <> 'array'
      or jsonb_array_length(v_order->'items') < 1
      or jsonb_array_length(v_order->'items') > 200 then
      raise exception 'Invalid BOCP order candidate';
    end if;
    if v_issued_at is not null and v_issued_at !~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$' then
      v_issued_at := null;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_invoice_number, 0));
    perform 1 from public.online_orders where invoice_number = v_invoice_number;
    if found then
      v_existing := v_existing + 1;
      continue;
    end if;

    v_pdf_url := nullif(trim(v_order->>'invoicePdfUrl'), '');
    if v_pdf_url is not null and v_pdf_url !~ '^https://secure\.bocp\.eu/' then
      raise exception 'Invalid BOCP invoice URL';
    end if;
    insert into public.online_orders (
      invoice_number, bocp_invoice_id, bocp_order_id, source,
      customer_name, customer_phone, customer_email, shipping_address,
      invoice_pdf_url, created_at
    ) values (
      v_invoice_number, v_invoice_id, nullif(trim(v_order->>'bocpOrderId'), ''), v_source::public.order_source,
      nullif(trim(v_order->>'customerName'), ''), nullif(trim(v_order->>'customerPhone'), ''),
      nullif(trim(v_order->>'customerEmail'), ''), nullif(trim(v_order->>'shippingAddress'), ''),
      v_pdf_url,
      -- BOCP times are Bucharest wall-clock times.
      coalesce(v_issued_at, v_invoice_date || ' 00:00:00')::timestamp at time zone 'Europe/Bucharest'
    ) returning id into v_order_id;

    for v_item in select value from pg_catalog.jsonb_array_elements(v_order->'items') loop
      v_sku := nullif(trim(v_item->>'sku'), '');
      v_bocp_product_id := nullif(trim(v_item->>'bocpProductId'), '');
      v_quantity_text := v_item->>'quantity';
      if v_sku is null or length(v_sku) > 100
        or v_bocp_product_id !~ '^[1-9][0-9]*$'
        or v_quantity_text !~ '^[1-9][0-9]*$'
        or v_quantity_text::numeric > 100000 then
        raise exception 'Invalid BOCP item candidate';
      end if;

      v_product_id := null;
      -- The catalog sync owns product names; an invoice only names a product it creates.
      insert into public.products (sku, bocp_product_id, name, synced_at)
      values (v_sku, v_bocp_product_id, coalesce(nullif(trim(v_item->>'name'), ''), v_sku), now())
      on conflict (sku) do update set
        bocp_product_id = excluded.bocp_product_id,
        synced_at = now()
      where public.products.bocp_product_id is null
        or public.products.bocp_product_id = excluded.bocp_product_id
      returning id into v_product_id;
      if v_product_id is null then raise exception 'SKU maps to a different BOCP product'; end if;

      insert into public.online_order_items (
        order_id, product_id, ean, scan_code, scan_code_type, quantity, is_gift
      ) values (
        v_order_id, v_product_id, nullif(trim(v_item->>'ean'), ''), v_sku, 'sku', v_quantity_text::integer,
        coalesce((v_item->>'gift')::boolean, false)
      );
    end loop;
    v_inserted := v_inserted + 1;
  end loop;

  return pg_catalog.jsonb_build_object('inserted', v_inserted, 'alreadyPresent', v_existing);
end
$$;

-- A product with no EAN has no barcode to scan: the operator ticks it as picked.
create function private.confirm_online_order_item(p_order_id uuid, p_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if (select auth.uid()) is null or (select private.current_role()) not in ('admin', 'operator_depozit') then
    return false;
  end if;
  perform 1 from public.online_orders
    where id = p_order_id and claimed_by = (select auth.uid()) and status in ('claimed', 'preparing')
    for update;
  if not found then return false; end if;
  update public.online_order_items i set scanned_quantity = i.quantity
    from public.products p
    where i.id = p_item_id and i.order_id = p_order_id and p.id = i.product_id
      and i.scanned_quantity < i.quantity
      and nullif(trim(p.ean), '') is null and nullif(trim(i.ean), '') is null;
  if not found then return false; end if;
  update public.online_orders set status = 'preparing' where id = p_order_id;
  return true;
end
$$;

create function public.confirm_online_order_item(p_order_id uuid, p_item_id uuid)
returns boolean language sql security invoker set search_path = ''
as $$ select private.confirm_online_order_item(p_order_id, p_item_id) $$;

revoke all on function private.confirm_online_order_item(uuid, uuid) from public, anon;
grant execute on function private.confirm_online_order_item(uuid, uuid) to authenticated;
revoke all on function public.confirm_online_order_item(uuid, uuid) from public, anon;
grant execute on function public.confirm_online_order_item(uuid, uuid) to authenticated;

-- Undo the invoice names the previous import wrote over catalog names.
update public.products
set name = btrim(regexp_replace(regexp_replace(regexp_replace(name,
      '^Atelier Rebul \([^)]*\)\s*', ''),
      '\s*_ar_\S+:\s*\d+', '', 'g'),
      '\s*\[[^\]]*\]\s*$', ''))
where name like 'Atelier Rebul (%';
