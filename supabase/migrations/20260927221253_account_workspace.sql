-- Workspace for the "account" role (B2B sales agents): own clients, discount rules, offers and
-- proformas, and sending an accepted offer into the normal warehouse → billing flow.

-- Catalog prices from BOCP (list price; discounts are applied per client or per document).
alter table public.products
  add column list_price numeric(12,2) check (list_price is null or list_price >= 0),
  add column list_price_with_vat numeric(12,2) check (list_price_with_vat is null or list_price_with_vat >= 0),
  add column vat_percent numeric(5,2) check (vat_percent is null or vat_percent between 0 and 100);

-- Each partner belongs to one agent.
alter table public.partners add column account_id uuid references public.app_users(id);
create index partners_account_idx on public.partners (account_id);

alter table public.refill_requests drop constraint refill_requests_source_check;
alter table public.refill_requests add constraint refill_requests_source_check
  check (source = any (array['whatsapp', 'app', 'telefon', 'oferta']));

-- True for the admin, and for an agent on a partner of their own.
create function private.can_manage_partner(p_partner_id uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $$
  select (select auth.uid()) is not null and (
    coalesce((select private.current_role()) = 'admin', false)
    or (coalesce((select private.current_role()) = 'account', false)
      and exists (select 1 from public.partners where id = p_partner_id and account_id = (select auth.uid()))))
$$;

-- Read access for agents: their own partners and everything hanging off them.
create policy account_own_partners on public.partners for select
  using ((select private.current_role()) = 'account' and account_id = (select auth.uid()));
create policy account_own_par_levels on public.partner_par_levels for select
  using ((select private.current_role()) = 'account' and exists (select 1 from public.partners r
    where r.id = partner_par_levels.partner_id and r.account_id = (select auth.uid())));
create policy account_own_carts on public.partner_carts for select
  using ((select private.current_role()) = 'account' and exists (select 1 from public.partners r
    where r.id = partner_carts.partner_id and r.account_id = (select auth.uid())));
create policy account_own_cart_items on public.partner_cart_items for select
  using ((select private.current_role()) = 'account' and exists (select 1 from public.partner_carts c
    join public.partners r on r.id = c.partner_id where c.id = partner_cart_items.cart_id and r.account_id = (select auth.uid())));
create policy account_catalog on public.products for select
  using ((select private.current_role()) = 'account');
create policy account_stock on public.warehouse_stock for select
  using ((select private.current_role()) = 'account');
create policy account_delivery_groups on public.delivery_groups for select
  using ((select private.current_role()) = 'account');
create policy account_partner_groups on public.partner_delivery_groups for select
  using ((select private.current_role()) = 'account');

-- Every partner as a plain list (name, type, agent): agents see colleagues' clients without access.
create function private.partner_directory()
returns table(id uuid, business_name text, location_name text, type text, active boolean, account_id uuid, account_name text)
language plpgsql
stable security definer
set search_path to ''
as $$
begin
  if not private.is_staff(array['admin', 'account', 'operator_depozit', 'operator_facturare']::public.user_role[]) then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  return query
    select p.id, p.business_name, p.location_name, p.type, p.active, p.account_id, u.full_name
    from public.partners p left join public.app_users u on u.id = p.account_id
    order by p.business_name;
end
$$;

-- Agents may add requests for their own partners (the warehouse and admin for any).
create or replace function private.staff_add_refill(p_partner_id uuid, p_items jsonb, p_source text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not (private.is_staff(array['admin', 'operator_depozit']::public.user_role[]) or private.can_manage_partner(p_partner_id)) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_source not in ('whatsapp', 'app', 'telefon') then
    raise exception 'Invalid source' using errcode = '22023';
  end if;
  return private.cart_add_items(p_partner_id, p_items, p_source);
end
$$;

-- Agents manage delivery groups too, but only move their own partners in or out.
create or replace function private.save_delivery_group(p_group_id uuid, p_name text, p_partner_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_id uuid := p_group_id;
  v_agent boolean := coalesce((select private.current_role()) = 'account', false);
begin
  if not private.is_staff(array['admin', 'operator_depozit', 'account']::public.user_role[]) then return null; end if;
  if length(v_name) not between 1 and 80 or coalesce(cardinality(p_partner_ids), 0) > 500 then return null; end if;
  if exists (select 1 from public.delivery_groups where lower(name) = lower(v_name) and id is distinct from p_group_id) then
    return null;
  end if;
  if v_agent and exists (select 1 from unnest(coalesce(p_partner_ids, '{}')) x(pid)
      join public.partners p on p.id = x.pid where p.account_id is distinct from (select auth.uid())
      and not exists (select 1 from public.partner_delivery_groups g where g.delivery_group_id = p_group_id and g.partner_id = x.pid)) then
    return null;
  end if;

  if v_id is null then
    insert into public.delivery_groups (name) values (v_name) returning id into v_id;
  else
    update public.delivery_groups set name = v_name where id = v_id;
    if not found then return null; end if;
  end if;

  delete from public.partner_delivery_groups g
    where g.delivery_group_id = v_id and g.partner_id <> all(coalesce(p_partner_ids, '{}'))
      and (not v_agent or exists (select 1 from public.partners p where p.id = g.partner_id and p.account_id = (select auth.uid())));
  insert into public.partner_delivery_groups (partner_id, delivery_group_id)
    select p.id, v_id from public.partners p where p.id = any(coalesce(p_partner_ids, '{}'))
    on conflict do nothing;
  return v_id;
end
$$;

-- Agents create and edit their own clients (the admin any); a new client belongs to its agent.
create function private.save_partner_profile(p_partner_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
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
      billing_zip = nullif(btrim(p_data->>'billing_zip'), ''), bocp_contact_id = nullif(p_data->>'bocp_contact_id', '')
    where id = v_id;
  end if;
  return v_id;
end
$$;

-- Initial stock (par level) of one product at a partner; 0 removes it.
create function private.set_partner_par_level(p_partner_id uuid, p_product_id uuid, p_quantity integer)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not private.can_manage_partner(p_partner_id) or p_quantity is null or p_quantity < 0 or p_quantity > 100000 then return false; end if;
  if p_quantity = 0 then
    delete from public.partner_par_levels where partner_id = p_partner_id and product_id = p_product_id;
    return true;
  end if;
  perform 1 from public.products where id = p_product_id and active;
  if not found then return false; end if;
  insert into public.partner_par_levels (partner_id, product_id, par_level_quantity, set_by)
    values (p_partner_id, p_product_id, p_quantity, (select auth.uid()))
    on conflict (partner_id, product_id) do update set par_level_quantity = excluded.par_level_quantity,
      set_by = excluded.set_by, updated_at = now();
  return true;
end
$$;

-- Discount rules: one on the whole range (category null) and/or one per product category.
create table public.partner_discounts (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  category text check (category is null or char_length(category) between 1 and 120),
  percent numeric(5,2) not null check (percent > 0 and percent < 100),
  created_at timestamptz not null default now(),
  unique nulls not distinct (partner_id, category)
);
alter table public.partner_discounts enable row level security;
create policy admin_all on public.partner_discounts for all using ((select private.current_role()) = 'admin');
create policy staff_discounts on public.partner_discounts for select
  using ((select private.current_role()) = any (array['operator_facturare'::public.user_role, 'operator_depozit'::public.user_role]));
create policy account_own_discounts on public.partner_discounts for select
  using ((select private.current_role()) = 'account' and exists (select 1 from public.partners r
    where r.id = partner_discounts.partner_id and r.account_id = (select auth.uid())));

create function private.save_partner_discounts(p_partner_id uuid, p_rules jsonb)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not private.can_manage_partner(p_partner_id) then return false; end if;
  if jsonb_typeof(p_rules) is distinct from 'array' or jsonb_array_length(p_rules) > 100 then
    raise exception 'Invalid rules' using errcode = '22023';
  end if;
  delete from public.partner_discounts where partner_id = p_partner_id;
  insert into public.partner_discounts (partner_id, category, percent)
    select p_partner_id, nullif(btrim(r->>'category'), ''), (r->>'percent')::numeric
    from jsonb_array_elements(p_rules) r
    where (r->>'percent') ~ '^\d{1,2}(\.\d{1,2})?$' and (r->>'percent')::numeric > 0;
  return true;
end
$$;

-- Offers and proformas made by agents. Prices are the BOCP list prices at the time of saving.
create table public.sales_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('offer', 'proforma')),
  number text unique,
  status text not null default 'draft' check (status in ('draft', 'issued', 'sent')),
  account_id uuid not null references public.app_users(id),
  partner_id uuid references public.partners(id),
  client_name text not null check (char_length(client_name) between 1 and 200),
  client_vat_id text check (client_vat_id is null or char_length(client_vat_id) <= 20),
  client_registration text check (client_registration is null or char_length(client_registration) <= 40),
  client_street text check (client_street is null or char_length(client_street) <= 200),
  client_city text check (client_city is null or char_length(client_city) <= 80),
  client_county text check (client_county is null or char_length(client_county) <= 80),
  client_zip text check (client_zip is null or char_length(client_zip) <= 12),
  contact_name text check (contact_name is null or char_length(contact_name) <= 120),
  contact_email text check (contact_email is null or char_length(contact_email) <= 254),
  contact_phone text check (contact_phone is null or char_length(contact_phone) <= 30),
  save_as_partner boolean not null default false,
  discount_percent numeric(5,2) not null default 0 check (discount_percent >= 0 and discount_percent < 100),
  validity_days integer not null default 15 check (validity_days between 1 and 365),
  notes text check (notes is null or char_length(notes) <= 2000),
  cart_id uuid references public.partner_carts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  issued_at timestamptz,
  sent_at timestamptz
);
create index sales_documents_account_idx on public.sales_documents (account_id, created_at desc);

create table public.sales_document_items (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.sales_documents(id) on delete cascade,
  product_id uuid not null references public.products(id),
  sku text not null,
  name text not null,
  quantity integer not null check (quantity between 1 and 100000),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  vat_percent numeric(5,2) not null check (vat_percent between 0 and 100),
  position integer not null default 0
);
create index sales_document_items_document_idx on public.sales_document_items (document_id, position);

alter table public.sales_documents enable row level security;
alter table public.sales_document_items enable row level security;
create policy admin_all on public.sales_documents for all using ((select private.current_role()) = 'admin');
create policy account_own_documents on public.sales_documents for select
  using ((select private.current_role()) = 'account' and account_id = (select auth.uid()));
create policy billing_documents on public.sales_documents for select
  using ((select private.current_role()) = 'operator_facturare' and cart_id is not null);
create policy admin_all on public.sales_document_items for all using ((select private.current_role()) = 'admin');
create policy document_items_read on public.sales_document_items for select
  using (exists (select 1 from public.sales_documents d where d.id = sales_document_items.document_id));

-- The cart an offer or proforma was sent as, so billing sees its terms.
alter table public.partner_carts add column source_document_id uuid references public.sales_documents(id);

create sequence public.sales_offer_number_seq;
create sequence public.sales_proforma_number_seq;

-- Creates or updates a draft. Items are {product_id, quantity}; prices come from the catalog.
create function private.save_sales_document(p_id uuid, p_doc jsonb, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_id uuid := p_id;
  v_partner uuid := nullif(p_doc->>'partner_id', '')::uuid;
  v_kind text := p_doc->>'kind';
begin
  if not private.is_staff(array['admin', 'account']::public.user_role[]) then return null; end if;
  if v_partner is not null and not private.can_manage_partner(v_partner) then return null; end if;
  if v_kind not in ('offer', 'proforma') or jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_items) not between 1 and 200 then
    raise exception 'Invalid document' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) i where (i->>'quantity') !~ '^[1-9]\d{0,5}$') then
    raise exception 'Invalid quantity' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) i left join public.products p on p.id = (i->>'product_id')::uuid
      where p.id is null or p.list_price is null) then
    raise exception 'Product without a BOCP price' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.sales_documents (kind, account_id, partner_id, client_name) values (v_kind, (select auth.uid()), v_partner, 'x')
      returning id into v_id;
  else
    perform 1 from public.sales_documents where id = v_id and status = 'draft'
      and (account_id = (select auth.uid()) or (select private.current_role()) = 'admin');
    if not found then return null; end if;
  end if;

  update public.sales_documents set
    kind = v_kind, partner_id = v_partner,
    client_name = btrim(p_doc->>'client_name'),
    client_vat_id = nullif(btrim(p_doc->>'client_vat_id'), ''), client_registration = nullif(btrim(p_doc->>'client_registration'), ''),
    client_street = nullif(btrim(p_doc->>'client_street'), ''), client_city = nullif(btrim(p_doc->>'client_city'), ''),
    client_county = nullif(btrim(p_doc->>'client_county'), ''), client_zip = nullif(btrim(p_doc->>'client_zip'), ''),
    contact_name = nullif(btrim(p_doc->>'contact_name'), ''), contact_email = nullif(btrim(p_doc->>'contact_email'), ''),
    contact_phone = nullif(btrim(p_doc->>'contact_phone'), ''),
    save_as_partner = v_partner is null and coalesce((p_doc->>'save_as_partner')::boolean, false),
    discount_percent = coalesce(nullif(p_doc->>'discount_percent', '')::numeric, 0),
    validity_days = coalesce(nullif(p_doc->>'validity_days', '')::integer, 15),
    notes = nullif(btrim(p_doc->>'notes'), ''),
    updated_at = now()
  where id = v_id;

  delete from public.sales_document_items where document_id = v_id;
  insert into public.sales_document_items (document_id, product_id, sku, name, quantity, unit_price, vat_percent, position)
    select v_id, p.id, p.sku, p.name, (i.value->>'quantity')::integer, p.list_price, coalesce(p.vat_percent, 21), i.ordinality
    from jsonb_array_elements(p_items) with ordinality i join public.products p on p.id = (i.value->>'product_id')::uuid;
  return v_id;
end
$$;

-- Gives the document its number (OF-2026-0001 / PF-2026-0001). A prospect marked "save as
-- partner" becomes a partner of the agent.
create function private.issue_sales_document(p_id uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_doc public.sales_documents%rowtype;
  v_number text;
  v_partner uuid;
begin
  select * into v_doc from public.sales_documents where id = p_id for update;
  if not found or v_doc.status <> 'draft'
    or not (v_doc.account_id = (select auth.uid()) or coalesce((select private.current_role()) = 'admin', false)) then
    return null;
  end if;
  v_number := case v_doc.kind when 'offer' then 'OF' else 'PF' end || '-' || to_char(now() at time zone 'Europe/Bucharest', 'YYYY') || '-'
    || lpad((case v_doc.kind when 'offer' then nextval('public.sales_offer_number_seq') else nextval('public.sales_proforma_number_seq') end)::text, 4, '0');

  v_partner := v_doc.partner_id;
  if v_partner is null and v_doc.save_as_partner then
    if v_doc.contact_phone is null or v_doc.contact_phone !~ '^[+0-9 ()-]{7,30}$' then
      raise exception 'A phone number is needed to save the partner' using errcode = '22023';
    end if;
    insert into public.partners (business_name, location_name, contact_phone, contact_email, account_id,
      billing_name, vat_id, registration_number, billing_street, billing_city, billing_county, billing_zip)
    values (v_doc.client_name, coalesce(v_doc.client_city, v_doc.client_name), v_doc.contact_phone, v_doc.contact_email, v_doc.account_id,
      v_doc.client_name, v_doc.client_vat_id, v_doc.client_registration, v_doc.client_street, v_doc.client_city, v_doc.client_county, v_doc.client_zip)
    returning id into v_partner;
  end if;

  update public.sales_documents set number = v_number, status = 'issued', issued_at = now(), partner_id = v_partner, updated_at = now()
    where id = p_id;
  return v_number;
end
$$;

-- An accepted offer/proforma goes the usual way: a request on the partner's cart, prepared by the
-- warehouse and invoiced by billing (who sees the document's terms on the cart).
create function private.send_sales_document(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_doc public.sales_documents%rowtype;
  v_items jsonb;
  v_result jsonb;
  v_cart uuid;
begin
  select * into v_doc from public.sales_documents where id = p_id for update;
  if not found or v_doc.status <> 'issued' or v_doc.partner_id is null
    or not (v_doc.account_id = (select auth.uid()) or coalesce((select private.current_role()) = 'admin', false)) then
    return null;
  end if;
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity) order by position) into v_items
    from public.sales_document_items where document_id = p_id;
  v_result := private.cart_add_items(v_doc.partner_id, v_items, 'oferta');
  v_cart := (v_result->>'cart_id')::uuid;
  update public.partner_carts set source_document_id = p_id where id = v_cart;
  update public.sales_documents set status = 'sent', sent_at = now(), cart_id = v_cart, updated_at = now() where id = p_id;
  return v_cart;
end
$$;

-- Tell the agent when billing invoices one of their clients' carts.
create or replace function private.mark_partner_cart_invoiced(p_cart_id uuid, p_invoice_number text,
  p_bocp_invoice_id text, p_invoice_date date, p_invoice_pdf_url text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_number text := nullif(btrim(p_invoice_number), '');
  v_partner record;
begin
  if (select auth.uid()) is null
    or not coalesce((select private.current_role()) in ('admin', 'operator_facturare'), false) then
    return false;
  end if;
  if v_number is null or char_length(v_number) > 60
    or p_bocp_invoice_id !~ '^[1-9][0-9]{0,18}$' or p_invoice_date is null
    or (p_invoice_pdf_url is not null and p_invoice_pdf_url !~ '^https://secure\.bocp\.eu/') then
    return false;
  end if;
  update public.partner_carts
    set invoiced_at = now(), invoiced_by = (select auth.uid()), invoice_number = v_number,
      bocp_invoice_id = p_bocp_invoice_id, invoice_date = p_invoice_date, invoice_pdf_url = p_invoice_pdf_url
    where id = p_cart_id and status = 'delivered' and invoiced_at is null;
  if not found then return false; end if;
  select p.business_name, p.account_id into v_partner
    from public.partner_carts c join public.partners p on p.id = c.partner_id where c.id = p_cart_id;
  if v_partner.account_id is not null then
    insert into public.notifications (recipient_user_id, type, message, related_entity_type, related_entity_id)
      values (v_partner.account_id, 'client_facturat', 'Comanda pentru ' || v_partner.business_name || ' a fost facturată (' || v_number || ').',
        'partner_cart', p_cart_id);
  end if;
  return true;
end
$$;

-- Public wrappers and grants.
create function public.partner_directory()
returns table(id uuid, business_name text, location_name text, type text, active boolean, account_id uuid, account_name text)
language sql stable security invoker set search_path = '' as $$ select * from private.partner_directory() $$;
create function public.save_partner_profile(p_partner_id uuid, p_data jsonb) returns uuid
language sql security invoker set search_path = '' as $$ select private.save_partner_profile(p_partner_id, p_data) $$;
create function public.set_partner_par_level(p_partner_id uuid, p_product_id uuid, p_quantity integer) returns boolean
language sql security invoker set search_path = '' as $$ select private.set_partner_par_level(p_partner_id, p_product_id, p_quantity) $$;
create function public.save_partner_discounts(p_partner_id uuid, p_rules jsonb) returns boolean
language sql security invoker set search_path = '' as $$ select private.save_partner_discounts(p_partner_id, p_rules) $$;
create function public.save_sales_document(p_id uuid, p_doc jsonb, p_items jsonb) returns uuid
language sql security invoker set search_path = '' as $$ select private.save_sales_document(p_id, p_doc, p_items) $$;
create function public.issue_sales_document(p_id uuid) returns text
language sql security invoker set search_path = '' as $$ select private.issue_sales_document(p_id) $$;
create function public.send_sales_document(p_id uuid) returns uuid
language sql security invoker set search_path = '' as $$ select private.send_sales_document(p_id) $$;

do $$
declare f text;
begin
  foreach f in array array[
    'private.can_manage_partner(uuid)', 'private.partner_directory()', 'private.save_partner_profile(uuid, jsonb)',
    'private.set_partner_par_level(uuid, uuid, integer)', 'private.save_partner_discounts(uuid, jsonb)',
    'private.save_sales_document(uuid, jsonb, jsonb)', 'private.issue_sales_document(uuid)', 'private.send_sales_document(uuid)',
    'public.partner_directory()', 'public.save_partner_profile(uuid, jsonb)', 'public.set_partner_par_level(uuid, uuid, integer)',
    'public.save_partner_discounts(uuid, jsonb)', 'public.save_sales_document(uuid, jsonb, jsonb)',
    'public.issue_sales_document(uuid)', 'public.send_sales_document(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
