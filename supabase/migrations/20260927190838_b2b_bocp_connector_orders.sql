-- B2B carts reserve stock in BOCP through the "hub.atelierrebul.ro" order connector (tested:
-- a connector order reserves the stock and cancelling it releases it). That replaces the manual
-- "move to Rezervat" step: the invoice keeps Magazia = ATELIER REBUL.

-- Billing data sent as the order's client. `bocp_contact_id` links a partner that already exists
-- as a client in BOCP; new partners are created in BOCP from these fields.
alter table public.partners
  add column bocp_contact_id text check (bocp_contact_id is null or bocp_contact_id ~ '^[1-9][0-9]{0,18}$'),
  add column billing_name text check (billing_name is null or char_length(billing_name) between 1 and 200),
  add column vat_id text check (vat_id is null or char_length(vat_id) between 2 and 20),
  add column registration_number text check (registration_number is null or char_length(registration_number) <= 40),
  add column billing_street text check (billing_street is null or char_length(billing_street) <= 200),
  add column billing_city text check (billing_city is null or char_length(billing_city) <= 80),
  add column billing_county text check (billing_county is null or char_length(billing_county) <= 80),
  add column billing_zip text check (billing_zip is null or char_length(billing_zip) <= 12),
  add column billing_country text not null default 'Romania' check (char_length(billing_country) <= 60);

-- The BOCP order behind a cart. `reserved_in_bocp_at` is set when BOCP accepted it.
alter table public.partner_carts
  add column bocp_order_id text check (bocp_order_id is null or bocp_order_id ~ '^[1-9][0-9]{0,18}$'),
  add column bocp_order_error text check (bocp_order_error is null or char_length(bocp_order_error) <= 500),
  add column bocp_order_attempted_at timestamptz;

create or replace function private.mark_partner_cart_prepared(p_cart_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not private.is_staff(array['admin', 'operator_depozit']::public.user_role[]) then return false; end if;
  update public.partner_carts c set status = 'prepared', prepared_at = now(), prepared_by = (select auth.uid())
    where c.id = p_cart_id and c.status = 'open'
      and exists (select 1 from public.partner_cart_items i where i.cart_id = c.id);
  return found;
end
$$;

-- Records the outcome of sending a cart to BOCP. A failure tells billing and the admin.
create function private.record_partner_cart_bocp_order(p_cart_id uuid, p_bocp_order_id text, p_error text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare v_partner text;
begin
  if not private.is_staff(array['admin', 'operator_depozit', 'operator_facturare']::public.user_role[]) then return false; end if;
  if p_bocp_order_id is not null then
    update public.partner_carts set bocp_order_id = p_bocp_order_id, bocp_order_error = null,
      bocp_order_attempted_at = now(), reserved_in_bocp_at = coalesce(reserved_in_bocp_at, now()),
      reserved_in_bocp_by = coalesce(reserved_in_bocp_by, (select auth.uid()))
      where id = p_cart_id and status in ('prepared', 'delivered');
    return found;
  end if;
  update public.partner_carts set bocp_order_error = left(coalesce(nullif(btrim(p_error), ''), 'Eroare necunoscută'), 500),
    bocp_order_attempted_at = now()
    where id = p_cart_id and status in ('prepared', 'delivered') and reserved_in_bocp_at is null;
  if not found then return false; end if;
  select p.business_name into v_partner
    from public.partner_carts c join public.partners p on p.id = c.partner_id where c.id = p_cart_id;
  perform private.notify('operator_facturare', 'rezervare_bocp_esuata',
    'Rezervarea în BOCP nu a reușit pentru ' || v_partner || ': ' || left(p_error, 200) || '. Reîncearcă din Facturare B2B → Rezervare.',
    'partner_cart', p_cart_id);
  return true;
end
$$;

create function public.record_partner_cart_bocp_order(p_cart_id uuid, p_bocp_order_id text, p_error text)
returns boolean language sql security invoker set search_path = ''
as $$ select private.record_partner_cart_bocp_order(p_cart_id, p_bocp_order_id, p_error) $$;

revoke all on function private.record_partner_cart_bocp_order(uuid, text, text) from public, anon;
grant execute on function private.record_partner_cart_bocp_order(uuid, text, text) to authenticated;
revoke all on function public.record_partner_cart_bocp_order(uuid, text, text) from public, anon;
grant execute on function public.record_partner_cart_bocp_order(uuid, text, text) to authenticated;

-- The manual "Mutat în Rezervat" confirmation is replaced by the connector order.
drop function public.mark_partner_cart_reserved_in_bocp(uuid);
drop function private.mark_partner_cart_reserved_in_bocp(uuid);
