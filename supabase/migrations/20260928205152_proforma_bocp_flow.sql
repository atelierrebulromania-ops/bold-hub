-- Offers stay in the Hub (PDF for the client). Proformas are issued in BOCP through the B2B connector
-- (an order paid by bank transfer: BOCP issues the proforma and reserves the stock). From an issued
-- proforma the agent may, at any time, reserve the order in the warehouse (usual flow: shelf, then
-- billing) or ask billing for the invoice directly. A dropped proforma releases the stock in BOCP and
-- asks billing to cancel the proforma there.

alter table public.sales_documents drop constraint sales_documents_status_check;
update public.sales_documents set status = 'issued' where status = 'sent';
alter table public.sales_documents add constraint sales_documents_status_check
  check (status in ('draft', 'issuing', 'issued', 'cancel_requested', 'cancelled'));

alter table public.sales_documents
  add column source_document_id uuid references public.sales_documents(id),
  add column bocp_order_id text check (bocp_order_id is null or bocp_order_id ~ '^[1-9][0-9]{0,18}$'),
  add column bocp_error text check (bocp_error is null or char_length(bocp_error) <= 500),
  add column bocp_proforma_id text unique check (bocp_proforma_id is null or bocp_proforma_id ~ '^[1-9][0-9]{0,18}$'),
  add column bocp_proforma_date date,
  add column bocp_proforma_total numeric(12,2),
  add column invoice_requested_at timestamptz,
  add column invoice_requested_by uuid references public.app_users(id),
  add column invoiced_at timestamptz,
  add column invoiced_by uuid references public.app_users(id),
  add column invoice_number text check (invoice_number is null or char_length(invoice_number) <= 60),
  add column bocp_invoice_id text check (bocp_invoice_id is null or bocp_invoice_id ~ '^[1-9][0-9]{0,18}$'),
  add column invoice_date date,
  add column invoice_pdf_url text check (invoice_pdf_url is null or invoice_pdf_url ~ '^https://secure\.bocp\.eu/'),
  add column cancel_requested_at timestamptz,
  add column cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.app_users(id);

-- Billing sees the documents it has to act on: invoice requests, cancellations and warehouse carts.
drop policy billing_documents on public.sales_documents;
create policy billing_documents on public.sales_documents for select
  using ((select private.current_role()) = 'operator_facturare'
    and (cart_id is not null or invoice_requested_at is not null or cancel_requested_at is not null));

create index sales_documents_billing_idx on public.sales_documents (invoice_requested_at) where invoice_requested_at is not null and invoiced_at is null;
create index sales_documents_cancel_idx on public.sales_documents (cancel_requested_at) where status = 'cancel_requested';

alter publication supabase_realtime add table public.sales_documents;

create function private.owns_document(p_doc public.sales_documents)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select (select auth.uid()) is not null and (p_doc.account_id = (select auth.uid()) or coalesce((select private.current_role()) = 'admin', false))
$$;

-- The partner of a document; a prospect marked "save as partner" becomes a partner of the agent.
create function private.document_partner(p_doc public.sales_documents)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_partner uuid := p_doc.partner_id;
begin
  if v_partner is null and p_doc.save_as_partner then
    if p_doc.contact_phone is null or p_doc.contact_phone !~ '^[+0-9 ()-]{7,30}$' then
      raise exception 'A phone number is needed to save the partner' using errcode = '22023';
    end if;
    insert into public.partners (business_name, location_name, contact_phone, contact_email, account_id,
      billing_name, vat_id, registration_number, billing_street, billing_city, billing_county, billing_zip)
    values (p_doc.client_name, coalesce(p_doc.client_city, p_doc.client_name), p_doc.contact_phone, p_doc.contact_email, p_doc.account_id,
      p_doc.client_name, p_doc.client_vat_id, p_doc.client_registration, p_doc.client_street, p_doc.client_city, p_doc.client_county, p_doc.client_zip)
    returning id into v_partner;
  end if;
  return v_partner;
end
$$;

-- Offers only: proformas get their number from BOCP.
create or replace function private.issue_sales_document(p_id uuid)
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
  if not found or v_doc.status <> 'draft' or v_doc.kind <> 'offer' or not private.owns_document(v_doc) then
    return null;
  end if;
  v_number := 'OF-' || to_char(now() at time zone 'Europe/Bucharest', 'YYYY') || '-' || lpad(nextval('public.sales_offer_number_seq')::text, 4, '0');
  v_partner := private.document_partner(v_doc);
  update public.sales_documents set number = v_number, status = 'issued', issued_at = now(), partner_id = v_partner, updated_at = now()
    where id = p_id;
  return v_number;
end
$$;

-- An issued offer becomes a proforma draft with the same client, terms and products.
create function private.offer_to_proforma(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_doc public.sales_documents%rowtype;
  v_new uuid;
begin
  select * into v_doc from public.sales_documents where id = p_id;
  if not found or v_doc.kind <> 'offer' or v_doc.status <> 'issued' or not private.owns_document(v_doc) then return null; end if;
  insert into public.sales_documents (kind, account_id, partner_id, client_name, client_vat_id, client_registration, client_street,
    client_city, client_county, client_zip, contact_name, contact_email, contact_phone, save_as_partner, discount_percent,
    validity_days, notes, source_document_id)
  values ('proforma', v_doc.account_id, v_doc.partner_id, v_doc.client_name, v_doc.client_vat_id, v_doc.client_registration,
    v_doc.client_street, v_doc.client_city, v_doc.client_county, v_doc.client_zip, v_doc.contact_name, v_doc.contact_email,
    v_doc.contact_phone, false, v_doc.discount_percent, v_doc.validity_days, v_doc.notes, p_id)
  returning id into v_new;
  insert into public.sales_document_items (document_id, product_id, sku, name, quantity, unit_price, vat_percent, position)
    select v_new, product_id, sku, name, quantity, unit_price, vat_percent, position from public.sales_document_items where document_id = p_id;
  return v_new;
end
$$;

-- Step 1 of issuing a proforma: the draft is locked while it is sent to BOCP. Also used to resend
-- a proforma whose BOCP order could not be created.
create function private.start_proforma_issue(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_doc public.sales_documents%rowtype;
begin
  select * into v_doc from public.sales_documents where id = p_id for update;
  if not found or v_doc.kind <> 'proforma' or not private.owns_document(v_doc)
    or not (v_doc.status = 'draft' or (v_doc.status = 'issuing' and v_doc.bocp_order_id is null)) then
    return false;
  end if;
  if coalesce(btrim(v_doc.client_vat_id), '') = '' or coalesce(btrim(v_doc.client_street), '') = ''
    or coalesce(btrim(v_doc.client_city), '') = '' or coalesce(btrim(v_doc.client_county), '') = '' then
    raise exception 'The proforma needs the client CUI and address' using errcode = '22023';
  end if;
  update public.sales_documents set status = 'issuing', partner_id = private.document_partner(v_doc), save_as_partner = false,
    bocp_error = null, updated_at = now()
  where id = p_id;
  return true;
end
$$;

-- Step 2: the BOCP order behind the proforma (or the error, which puts the draft back for editing).
create function private.record_proforma_order(p_id uuid, p_bocp_order_id text, p_error text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_doc public.sales_documents%rowtype;
begin
  select * into v_doc from public.sales_documents where id = p_id for update;
  if not found or v_doc.status <> 'issuing' or not private.owns_document(v_doc) then return false; end if;
  if p_bocp_order_id is not null then
    if p_bocp_order_id !~ '^[1-9][0-9]{0,18}$' then return false; end if;
    update public.sales_documents set bocp_order_id = p_bocp_order_id, bocp_error = null, updated_at = now() where id = p_id;
  else
    update public.sales_documents set status = 'draft', bocp_error = left(coalesce(nullif(btrim(p_error), ''), 'Eroare BOCP'), 500), updated_at = now()
      where id = p_id and bocp_order_id is null;
  end if;
  return true;
end
$$;

-- Step 3: the proforma BOCP issued for that order.
create function private.record_proforma_number(p_id uuid, p_bocp_proforma_id text, p_number text, p_date date, p_total numeric)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_doc public.sales_documents%rowtype;
begin
  select * into v_doc from public.sales_documents where id = p_id for update;
  if not found or v_doc.status <> 'issuing' or v_doc.bocp_order_id is null or not private.owns_document(v_doc)
    or p_bocp_proforma_id !~ '^[1-9][0-9]{0,18}$' or nullif(btrim(p_number), '') is null or char_length(p_number) > 60 or p_date is null then
    return false;
  end if;
  update public.sales_documents set status = 'issued', number = btrim(p_number), bocp_proforma_id = p_bocp_proforma_id,
    bocp_proforma_date = p_date, bocp_proforma_total = p_total, issued_at = now(), updated_at = now()
  where id = p_id;
  return true;
end
$$;

-- "Rezervă comanda": the proforma's products go to the warehouse as a request on the partner's cart.
-- Their stock is already reserved in BOCP by the proforma's order.
create or replace function private.send_sales_document(p_id uuid)
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
  v_other uuid;
begin
  select * into v_doc from public.sales_documents where id = p_id for update;
  if not found or v_doc.kind <> 'proforma' or v_doc.status <> 'issued' or v_doc.partner_id is null or v_doc.cart_id is not null
    or v_doc.invoice_requested_at is not null or not private.owns_document(v_doc) then
    return null;
  end if;
  select source_document_id into v_other from public.partner_carts where partner_id = v_doc.partner_id and status = 'open';
  if v_other is not null and v_other <> p_id then
    raise exception 'The partner has an open cart from another document' using errcode = '55000';
  end if;
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity) order by position) into v_items
    from public.sales_document_items where document_id = p_id;
  v_result := private.cart_add_items(v_doc.partner_id, v_items, 'oferta');
  v_cart := (v_result->>'cart_id')::uuid;
  update public.partner_carts set source_document_id = p_id where id = v_cart;
  update public.sales_documents set cart_id = v_cart, sent_at = now(), updated_at = now() where id = p_id;
  return v_cart;
end
$$;

-- "Cere factura": billing invoices the proforma directly, without the warehouse.
create function private.request_document_invoice(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_doc public.sales_documents%rowtype;
begin
  select * into v_doc from public.sales_documents where id = p_id for update;
  if not found or v_doc.kind <> 'proforma' or v_doc.status <> 'issued' or v_doc.cart_id is not null
    or v_doc.invoice_requested_at is not null or not private.owns_document(v_doc) then
    return false;
  end if;
  update public.sales_documents set invoice_requested_at = now(), invoice_requested_by = (select auth.uid()), updated_at = now() where id = p_id;
  perform private.notify('operator_facturare', 'cerere_factura',
    'Cerere de factură: ' || v_doc.client_name || ' — proforma ' || v_doc.number || '.', 'sales_document', p_id);
  return true;
end
$$;

create function private.mark_document_invoiced(p_id uuid, p_invoice_number text, p_bocp_invoice_id text, p_invoice_date date, p_invoice_pdf_url text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_doc public.sales_documents%rowtype;
  v_number text := nullif(btrim(p_invoice_number), '');
begin
  if (select auth.uid()) is null or not coalesce((select private.current_role()) in ('admin', 'operator_facturare'), false) then return false; end if;
  if v_number is null or char_length(v_number) > 60 or p_bocp_invoice_id !~ '^[1-9][0-9]{0,18}$' or p_invoice_date is null
    or (p_invoice_pdf_url is not null and p_invoice_pdf_url !~ '^https://secure\.bocp\.eu/') then
    return false;
  end if;
  update public.sales_documents set invoiced_at = now(), invoiced_by = (select auth.uid()), invoice_number = v_number,
    bocp_invoice_id = p_bocp_invoice_id, invoice_date = p_invoice_date, invoice_pdf_url = p_invoice_pdf_url, updated_at = now()
  where id = p_id and status = 'issued' and invoice_requested_at is not null and invoiced_at is null
  returning * into v_doc;
  if not found then return false; end if;
  insert into public.notifications (recipient_user_id, type, message, related_entity_type, related_entity_id)
    values (v_doc.account_id, 'client_facturat', 'Proforma ' || v_doc.number || ' pentru ' || v_doc.client_name || ' a fost facturată (' || v_number || ').',
      'sales_document', p_id);
  return true;
end
$$;

-- The agent drops a proforma: the app has already released the stock in BOCP; billing cancels the
-- proforma document in BOCP.
create function private.request_proforma_cancel(p_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_doc public.sales_documents%rowtype;
begin
  select * into v_doc from public.sales_documents where id = p_id for update;
  if not found or v_doc.kind <> 'proforma' or v_doc.status <> 'issued' or v_doc.cart_id is not null
    or v_doc.invoice_requested_at is not null or not private.owns_document(v_doc) then
    return false;
  end if;
  update public.sales_documents set status = 'cancel_requested', cancel_requested_at = now(),
    cancel_reason = left(nullif(btrim(p_reason), ''), 500), updated_at = now()
  where id = p_id;
  perform private.notify('operator_facturare', 'anulare_proforma',
    'Anulează în BOCP proforma ' || v_doc.number || ' — ' || v_doc.client_name || '.', 'sales_document', p_id);
  return true;
end
$$;

create function private.confirm_proforma_cancelled(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_doc public.sales_documents%rowtype;
begin
  if (select auth.uid()) is null or not coalesce((select private.current_role()) in ('admin', 'operator_facturare'), false) then return false; end if;
  update public.sales_documents set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()), updated_at = now()
    where id = p_id and status = 'cancel_requested'
    returning * into v_doc;
  if not found then return false; end if;
  insert into public.notifications (recipient_user_id, type, message, related_entity_type, related_entity_id)
    values (v_doc.account_id, 'proforma_anulata', 'Proforma ' || v_doc.number || ' pentru ' || v_doc.client_name || ' a fost anulată în BOCP.',
      'sales_document', p_id);
  return true;
end
$$;

create function public.offer_to_proforma(p_id uuid) returns uuid
language sql security invoker set search_path = '' as $$ select private.offer_to_proforma(p_id) $$;
create function public.start_proforma_issue(p_id uuid) returns boolean
language sql security invoker set search_path = '' as $$ select private.start_proforma_issue(p_id) $$;
create function public.record_proforma_order(p_id uuid, p_bocp_order_id text, p_error text) returns boolean
language sql security invoker set search_path = '' as $$ select private.record_proforma_order(p_id, p_bocp_order_id, p_error) $$;
create function public.record_proforma_number(p_id uuid, p_bocp_proforma_id text, p_number text, p_date date, p_total numeric) returns boolean
language sql security invoker set search_path = '' as $$ select private.record_proforma_number(p_id, p_bocp_proforma_id, p_number, p_date, p_total) $$;
create function public.request_document_invoice(p_id uuid) returns boolean
language sql security invoker set search_path = '' as $$ select private.request_document_invoice(p_id) $$;
create function public.mark_document_invoiced(p_id uuid, p_invoice_number text, p_bocp_invoice_id text, p_invoice_date date, p_invoice_pdf_url text) returns boolean
language sql security invoker set search_path = '' as $$ select private.mark_document_invoiced(p_id, p_invoice_number, p_bocp_invoice_id, p_invoice_date, p_invoice_pdf_url) $$;
create function public.request_proforma_cancel(p_id uuid, p_reason text) returns boolean
language sql security invoker set search_path = '' as $$ select private.request_proforma_cancel(p_id, p_reason) $$;
create function public.confirm_proforma_cancelled(p_id uuid) returns boolean
language sql security invoker set search_path = '' as $$ select private.confirm_proforma_cancelled(p_id) $$;

do $$
declare f text;
begin
  foreach f in array array[
    'private.owns_document(public.sales_documents)', 'private.document_partner(public.sales_documents)',
    'private.offer_to_proforma(uuid)', 'private.start_proforma_issue(uuid)', 'private.record_proforma_order(uuid, text, text)',
    'private.record_proforma_number(uuid, text, text, date, numeric)', 'private.request_document_invoice(uuid)',
    'private.mark_document_invoiced(uuid, text, text, date, text)', 'private.request_proforma_cancel(uuid, text)',
    'private.confirm_proforma_cancelled(uuid)',
    'public.offer_to_proforma(uuid)', 'public.start_proforma_issue(uuid)', 'public.record_proforma_order(uuid, text, text)',
    'public.record_proforma_number(uuid, text, text, date, numeric)', 'public.request_document_invoice(uuid)',
    'public.mark_document_invoiced(uuid, text, text, date, text)', 'public.request_proforma_cancel(uuid, text)',
    'public.confirm_proforma_cancelled(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
