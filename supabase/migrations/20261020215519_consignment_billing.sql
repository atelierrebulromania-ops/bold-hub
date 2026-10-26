-- Consignment billing.
-- A delivery to a consignment client is not invoiced: billing moves the goods with a BOCP transfer voucher
-- (ATELIER REBUL → CONSIGNATIE) and records its number; the cart is then done like an invoiced one.
-- Periodically billing invoices what the client sold (worked out from its shelf counts and the deliveries) and
-- records the BOCP invoice; the commission is worked out on the invoice value without VAT.

alter table public.partner_carts add column bocp_transfer_number text
  constraint partner_carts_transfer_number_check check (bocp_transfer_number is null or char_length(bocp_transfer_number) <= 60);

create table public.consignment_settlements (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  period_from timestamptz,
  period_to timestamptz not null,
  lines jsonb not null default '[]'::jsonb,
  invoice_number text not null,
  bocp_invoice_id text not null,
  invoice_date date,
  invoice_pdf_url text,
  invoice_total numeric(12,2),
  invoice_net numeric(12,2),
  commission_percent numeric(5,2) not null,
  commission_amount numeric(12,2),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index consignment_settlements_invoice_idx on public.consignment_settlements (bocp_invoice_id);
create index consignment_settlements_partner_idx on public.consignment_settlements (partner_id, period_to desc);
alter table public.consignment_settlements enable row level security;
create policy staff_read on public.consignment_settlements for select to authenticated
  using ((select private.current_role()) = any (array['admin'::public.user_role, 'owner'::public.user_role, 'operator_facturare'::public.user_role]));
create policy account_own on public.consignment_settlements for select to authenticated
  using ((select private.current_role()) = 'account'::public.user_role
    and exists (select 1 from public.partners p where p.id = consignment_settlements.partner_id and p.account_id = (select auth.uid())));

-- Handed consignment carts get the transfer voucher number instead of an invoice (one voucher may cover several).
CREATE FUNCTION private.mark_partner_carts_transferred(p_cart_ids uuid[], p_transfer_number text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_count integer;
begin
  if not private.is_staff(array['admin', 'operator_facturare']::public.user_role[]) then raise exception 'Billing access required' using errcode = '42501'; end if;
  if nullif(btrim(p_transfer_number), '') is null or char_length(btrim(p_transfer_number)) > 60
    or coalesce(array_length(p_cart_ids, 1), 0) = 0 then raise exception 'Invalid transfer' using errcode = '22023'; end if;
  update public.partner_carts c set bocp_transfer_number = btrim(p_transfer_number), invoice_number = btrim(p_transfer_number),
      invoiced_at = now(), invoiced_by = (select auth.uid()), invoiced_with = case when c.id = p_cart_ids[1] then null else p_cart_ids[1] end
    from public.partners p
    where c.id = any(p_cart_ids) and p.id = c.partner_id and p.sales_mode = 'consignment' and c.status = 'delivered' and c.invoiced_at is null;
  get diagnostics v_count = row_count;
  return v_count = array_length(p_cart_ids, 1);
end
$function$;

-- What a consignment client sold up to p_to, since its last settlement, per product (resale stock):
-- stock at a moment = the last count before it + what was delivered after that count; sold = stock at the start
-- + delivered in the period − stock at the end.
CREATE FUNCTION private.consignment_sales(p_partner_id uuid, p_to timestamptz DEFAULT now())
 RETURNS TABLE(product_id uuid, sold integer, delivered integer, on_shelf integer, last_count_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with bounds as (
    select coalesce((select max(s.period_to) from public.consignment_settlements s where s.partner_id = p_partner_id), '-infinity'::timestamptz) as t0
  ),
  deliveries as (
    select c.location_id, i.product_id, c.delivered_at as at, i.quantity_needed as qty
    from public.partner_carts c join public.partner_cart_items i on i.cart_id = c.id
    where c.partner_id = p_partner_id and c.status = 'delivered' and c.delivered_at is not null and i.channel = 'resale' and c.delivered_at <= p_to
  ),
  keys as (
    select distinct location_id, product_id from deliveries
    union select distinct location_id, product_id from public.partner_stock_counts where partner_id = p_partner_id and channel = 'resale'
  ),
  stock as (
    select k.location_id, k.product_id, edge.t,
      coalesce(lc.remaining, 0) + coalesce((select sum(d.qty) from deliveries d where d.product_id = k.product_id and d.location_id is not distinct from k.location_id
        and d.at > coalesce(lc.counted_at, '-infinity'::timestamptz) and d.at <= edge.t), 0) as qty,
      lc.counted_at
    from keys k
    cross join lateral (select (select t0 from bounds) as t union all select p_to) edge
    left join lateral (select sc.remaining, sc.counted_at from public.partner_stock_counts sc
      where sc.partner_id = p_partner_id and sc.channel = 'resale' and sc.product_id = k.product_id and sc.location_id is not distinct from k.location_id
        and sc.counted_at <= edge.t order by sc.counted_at desc limit 1) lc on true
  ),
  per_point as (
    select k.location_id, k.product_id,
      greatest(0, coalesce(f.qty, 0) + coalesce((select sum(d.qty) from deliveries d where d.product_id = k.product_id and d.location_id is not distinct from k.location_id
        and d.at > (select t0 from bounds)), 0) - coalesce(e.qty, 0))::integer as sold,
      coalesce((select sum(d.qty) from deliveries d where d.product_id = k.product_id and d.location_id is not distinct from k.location_id and d.at > (select t0 from bounds)), 0)::integer as delivered,
      coalesce(e.qty, 0)::integer as on_shelf, e.counted_at
    from keys k
    left join stock f on f.location_id is not distinct from k.location_id and f.product_id = k.product_id and f.t = (select t0 from bounds)
    left join stock e on e.location_id is not distinct from k.location_id and e.product_id = k.product_id and e.t = p_to
  )
  select product_id, sum(sold)::integer, sum(delivered)::integer, sum(on_shelf)::integer, max(counted_at)
  from per_point
  where private.is_staff(array['admin', 'owner', 'operator_facturare']::public.user_role[]) or private.can_manage_partner(p_partner_id)
  group by product_id
$function$;

-- Billing closes the period with the BOCP invoice it issued for the sold products.
CREATE FUNCTION private.record_consignment_settlement(p_partner_id uuid, p_period_to timestamptz, p_invoice_number text, p_bocp_invoice_id text,
  p_invoice_date date, p_invoice_pdf_url text, p_invoice_total numeric, p_invoice_net numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_partner record; v_from timestamptz; v_id uuid; v_lines jsonb;
begin
  if not private.is_staff(array['admin', 'operator_facturare']::public.user_role[]) then raise exception 'Billing access required' using errcode = '42501'; end if;
  select id, consignment_commission, sales_mode into v_partner from public.partners where id = p_partner_id for update;
  if not found or v_partner.sales_mode <> 'consignment' then return null; end if;
  if p_period_to is null or p_period_to > now() + interval '1 minute' then raise exception 'Invalid period' using errcode = '22023'; end if;
  select max(period_to) into v_from from public.consignment_settlements where partner_id = p_partner_id;
  if v_from is not null and p_period_to <= v_from then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('product_id', s.product_id, 'sku', p.sku, 'name', p.name, 'sold', s.sold) order by p.name), '[]'::jsonb)
    into v_lines
    from private.consignment_sales(p_partner_id, p_period_to) s join public.products p on p.id = s.product_id where s.sold > 0;
  insert into public.consignment_settlements (partner_id, period_from, period_to, lines, invoice_number, bocp_invoice_id, invoice_date, invoice_pdf_url,
      invoice_total, invoice_net, commission_percent, commission_amount, created_by)
    values (p_partner_id, v_from, p_period_to, v_lines, p_invoice_number, p_bocp_invoice_id, p_invoice_date, p_invoice_pdf_url, p_invoice_total, p_invoice_net,
      coalesce(v_partner.consignment_commission, 0), round(coalesce(p_invoice_net, 0) * coalesce(v_partner.consignment_commission, 0) / 100, 2), (select auth.uid()))
    returning id into v_id;
  return v_id;
end
$function$;

do $$
declare f text;
begin
  foreach f in array array['mark_partner_carts_transferred(uuid[], text)', 'consignment_sales(uuid, timestamptz)',
      'record_consignment_settlement(uuid, timestamptz, text, text, date, text, numeric, numeric)'] loop
    execute format('revoke all on function private.%s from public, anon', f);
    execute format('grant execute on function private.%s to authenticated', f);
  end loop;
end $$;

CREATE FUNCTION public.mark_partner_carts_transferred(p_cart_ids uuid[], p_transfer_number text) RETURNS boolean LANGUAGE sql SET search_path TO ''
AS $function$ select private.mark_partner_carts_transferred(p_cart_ids, p_transfer_number) $function$;
CREATE FUNCTION public.consignment_sales(p_partner_id uuid, p_to timestamptz DEFAULT now())
 RETURNS TABLE(product_id uuid, sold integer, delivered integer, on_shelf integer, last_count_at timestamptz) LANGUAGE sql STABLE SET search_path TO ''
AS $function$ select * from private.consignment_sales(p_partner_id, p_to) $function$;
CREATE FUNCTION public.record_consignment_settlement(p_partner_id uuid, p_period_to timestamptz, p_invoice_number text, p_bocp_invoice_id text,
  p_invoice_date date, p_invoice_pdf_url text, p_invoice_total numeric, p_invoice_net numeric) RETURNS uuid LANGUAGE sql SET search_path TO ''
AS $function$ select private.record_consignment_settlement(p_partner_id, p_period_to, p_invoice_number, p_bocp_invoice_id, p_invoice_date, p_invoice_pdf_url, p_invoice_total, p_invoice_net) $function$;
do $$
declare f text;
begin
  foreach f in array array['mark_partner_carts_transferred(uuid[], text)', 'consignment_sales(uuid, timestamptz)',
      'record_consignment_settlement(uuid, timestamptz, text, text, date, text, numeric, numeric)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
