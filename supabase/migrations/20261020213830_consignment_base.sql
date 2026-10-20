-- Consignment, first part: the client's regime (purchase or consignment, with its commission), a log of every
-- shelf count (sales are worked out from it: what was there, plus what was delivered, minus what is left) and
-- the BOCP custody voucher number on custody items. Also: saving the client file no longer drops its BOCP link.

alter table public.partners
  add column sales_mode text not null default 'purchase' constraint partners_sales_mode_check check (sales_mode in ('purchase', 'consignment')),
  add column consignment_commission numeric(5,2) constraint partners_consignment_commission_check check (consignment_commission is null or consignment_commission between 0 and 100);

alter table public.partner_custody_items add column document_number text
  constraint partner_custody_document_check check (document_number is null or char_length(document_number) <= 60);

create table public.partner_stock_counts (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  location_id uuid references public.partner_locations(id) on delete set null,
  channel text not null default 'resale' constraint partner_stock_counts_channel_check check (channel in ('resale', 'consumption')),
  product_id uuid not null references public.products(id) on delete cascade,
  remaining integer not null constraint partner_stock_counts_remaining_check check (remaining between 0 and 1000000),
  counted_at timestamptz not null default now(),
  counted_by uuid references auth.users(id) on delete set null
);
create index partner_stock_counts_lookup_idx on public.partner_stock_counts (partner_id, product_id, channel, counted_at desc);
alter table public.partner_stock_counts enable row level security;
create policy staff_read on public.partner_stock_counts for select to authenticated
  using ((select private.current_role()) = any (array['admin'::public.user_role, 'owner'::public.user_role, 'operator_facturare'::public.user_role]));
create policy account_own on public.partner_stock_counts for select to authenticated
  using ((select private.current_role()) = 'account'::public.user_role
    and exists (select 1 from public.partners p where p.id = partner_stock_counts.partner_id and p.account_id = (select auth.uid())));

-- Every count is logged (also when nothing needs ordering), then the missing quantities go to the cart.
CREATE OR REPLACE FUNCTION private.refill_counts_for(p_partner_id uuid, p_counts jsonb, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_items jsonb := '[]'::jsonb;
  v_row record;
  v_central boolean := (select stock_mode = 'central' from public.partners where id = p_partner_id);
  v_location uuid := private.order_location(p_partner_id, p_location_id);
begin
  if jsonb_typeof(p_counts) is distinct from 'array' or jsonb_array_length(p_counts) > 500 then
    raise exception 'Invalid counts' using errcode = '22023';
  end if;

  for v_row in
    select pl.product_id, pl.channel, greatest(0, (c->>'remaining')::integer) as remaining,
      pl.par_level_quantity - greatest(0, (c->>'remaining')::integer) - coalesce((
        select sum(i.quantity_needed) from public.partner_cart_items i
        join public.partner_carts rc on rc.id = i.cart_id
        where rc.partner_id = p_partner_id and rc.status::text in ('open', 'prepared', 'pending_delivery')
          and (v_central or rc.location_id = v_location)
          and i.product_id = pl.product_id and i.channel = pl.channel), 0) - coalesce((
        select sum(b.quantity) from public.partner_backorders b
        where b.partner_id = p_partner_id and b.product_id = pl.product_id and b.channel = pl.channel and b.status in ('open', 'shelved')
          and (v_central or b.location_id = v_location)), 0) as needed
    from jsonb_array_elements(p_counts) c
    join public.partner_par_levels pl on pl.partner_id = p_partner_id and pl.product_id = (c->>'product_id')::uuid
      and pl.channel = coalesce(c->>'channel', 'resale')
      and (case when v_central then pl.location_id is null else pl.location_id = v_location end)
    join public.products p on p.id = pl.product_id and p.active
    where (c->>'remaining') ~ '^\d{1,6}$'
  loop
    insert into public.partner_stock_counts (partner_id, location_id, channel, product_id, remaining, counted_by)
      values (p_partner_id, v_location, v_row.channel, v_row.product_id, v_row.remaining, (select auth.uid()));
    if v_row.needed > 0 then
      v_items := v_items || jsonb_build_object('product_id', v_row.product_id, 'quantity', v_row.needed, 'channel', v_row.channel);
    end if;
  end loop;

  if jsonb_array_length(v_items) = 0 then
    return jsonb_build_object('items', 0, 'units', 0);
  end if;
  return private.cart_add_items(p_partner_id, v_items, 'app', v_location);
end
$function$;

-- Purchase (invoiced at delivery) or consignment (invoiced on what was sold, with the client's commission).
CREATE FUNCTION private.set_partner_sales_mode(p_partner_id uuid, p_mode text, p_commission numeric)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.can_manage_partner(p_partner_id) then return false; end if;
  if p_mode not in ('purchase', 'consignment') or (p_mode = 'consignment' and (p_commission is null or p_commission not between 0 and 100)) then
    raise exception 'Invalid sales mode' using errcode = '22023';
  end if;
  update public.partners set sales_mode = p_mode, consignment_commission = case when p_mode = 'consignment' then p_commission end where id = p_partner_id;
  return true;
end
$function$;
revoke all on function private.set_partner_sales_mode(uuid, text, numeric) from public, anon;
grant execute on function private.set_partner_sales_mode(uuid, text, numeric) to authenticated;
CREATE FUNCTION public.set_partner_sales_mode(p_partner_id uuid, p_mode text, p_commission numeric) RETURNS boolean LANGUAGE sql SET search_path TO ''
AS $function$ select private.set_partner_sales_mode(p_partner_id, p_mode, p_commission) $function$;
revoke all on function public.set_partner_sales_mode(uuid, text, numeric) from public, anon;
grant execute on function public.set_partner_sales_mode(uuid, text, numeric) to authenticated;

-- Custody items keep the number of the BOCP custody voucher (bon de custodie).
CREATE OR REPLACE FUNCTION private.save_custody_item(p_id uuid, p_partner_id uuid, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_location uuid := nullif(p_data->>'location_id', '')::uuid;
  v_kind text := p_data->>'kind';
  v_handed date := coalesce(nullif(p_data->>'handed_on', '')::date, current_date);
  v_trial_days integer := coalesce(nullif(p_data->>'trial_days', '')::integer, 30);
  v_document text := nullif(left(btrim(coalesce(p_data->>'document_number', '')), 60), '');
begin
  if not private.can_manage_partner(p_partner_id) then return null; end if;
  if v_location is not null and not exists (select 1 from public.partner_locations where id = v_location and partner_id = p_partner_id) then
    raise exception 'Invalid point' using errcode = '22023';
  end if;
  if v_kind not in ('tester', 'pos', 'trial') or v_trial_days not between 1 and 365 then raise exception 'Invalid item' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.partner_custody_items (partner_id, location_id, kind, product_id, name, quantity, unit_value, handed_on, trial_ends_on, note, document_number, created_by)
      values (p_partner_id, v_location, v_kind, nullif(p_data->>'product_id', '')::uuid, btrim(p_data->>'name'), (p_data->>'quantity')::integer,
        nullif(p_data->>'unit_value', '')::numeric, v_handed, case when v_kind = 'trial' then v_handed + v_trial_days end,
        nullif(btrim(coalesce(p_data->>'note', '')), ''), v_document, (select auth.uid()))
      returning id into v_id;
  else
    update public.partner_custody_items set location_id = v_location, kind = v_kind, product_id = nullif(p_data->>'product_id', '')::uuid,
      name = btrim(p_data->>'name'), quantity = (p_data->>'quantity')::integer, unit_value = nullif(p_data->>'unit_value', '')::numeric,
      handed_on = v_handed, trial_ends_on = case when v_kind = 'trial' then v_handed + v_trial_days end,
      trial_notified_at = case when v_kind = 'trial' and trial_ends_on is distinct from v_handed + v_trial_days then null else trial_notified_at end,
      note = nullif(btrim(coalesce(p_data->>'note', '')), ''), document_number = v_document, updated_at = now()
      where id = p_id and partner_id = p_partner_id
      returning id into v_id;
  end if;
  return v_id;
end
$function$;

-- The client file (agent) does not carry the BOCP link: keep it unless it is sent.
CREATE OR REPLACE FUNCTION private.save_partner_profile(p_partner_id uuid, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid := p_partner_id;
  v_name text := nullif(btrim(p_data->>'business_name'), '');
  v_location text := nullif(btrim(p_data->>'location_name'), '');
  v_phone text := nullif(btrim(p_data->>'contact_phone'), '');
  v_type text := coalesce(nullif(p_data->>'type', ''), 'reseller');
begin
  if v_id is null then
    if not private.is_staff(array['admin', 'account']::public.user_role[]) then return null; end if;
  elsif not private.can_manage_partner(v_id) then
    return null;
  end if;
  if v_name is null or length(v_name) > 160 or v_location is null or length(v_location) > 160
    or v_phone is null or v_phone !~ '^[+0-9 ()-]{7,30}$' or v_type not in ('reseller', 'horeca', 'altul') then
    raise exception 'Invalid partner' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.partners (business_name, location_name, contact_phone, contact_email, type, is_important_client, account_id,
      billing_name, vat_id, registration_number, billing_street, billing_city, billing_county, billing_zip, bocp_contact_id)
    values (v_name, v_location, v_phone, nullif(btrim(p_data->>'contact_email'), ''), v_type,
      coalesce((p_data->>'is_important_client')::boolean, false),
      case when (select private.current_role()) = 'account' then (select auth.uid()) else nullif(p_data->>'account_id', '')::uuid end,
      nullif(btrim(p_data->>'billing_name'), ''), nullif(btrim(p_data->>'vat_id'), ''), nullif(btrim(p_data->>'registration_number'), ''),
      nullif(btrim(p_data->>'billing_street'), ''), nullif(btrim(p_data->>'billing_city'), ''), nullif(btrim(p_data->>'billing_county'), ''),
      nullif(btrim(p_data->>'billing_zip'), ''), nullif(p_data->>'bocp_contact_id', ''))
    returning id into v_id;
  else
    update public.partners set business_name = v_name, location_name = v_location, contact_phone = v_phone,
      contact_email = nullif(btrim(p_data->>'contact_email'), ''), type = v_type,
      is_important_client = coalesce((p_data->>'is_important_client')::boolean, is_important_client),
      billing_name = nullif(btrim(p_data->>'billing_name'), ''), vat_id = nullif(btrim(p_data->>'vat_id'), ''),
      registration_number = nullif(btrim(p_data->>'registration_number'), ''), billing_street = nullif(btrim(p_data->>'billing_street'), ''),
      billing_city = nullif(btrim(p_data->>'billing_city'), ''), billing_county = nullif(btrim(p_data->>'billing_county'), ''),
      billing_zip = nullif(btrim(p_data->>'billing_zip'), ''),
      bocp_contact_id = case when p_data ? 'bocp_contact_id' then nullif(p_data->>'bocp_contact_id', '') else bocp_contact_id end
    where id = v_id;
  end if;
  return v_id;
end
$function$;
