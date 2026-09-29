-- A product on an offer/proforma may have its own discount; null means it takes the document's.
alter table public.sales_document_items
  add column discount_percent numeric(5,2) check (discount_percent is null or (discount_percent >= 0 and discount_percent < 100));

create or replace function private.save_sales_document(p_id uuid, p_doc jsonb, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_id uuid := p_id;
  v_partner uuid := nullif(p_doc->>'partner_id', '')::uuid;
  v_kind text := p_doc->>'kind';
  v_current public.sales_documents%rowtype;
begin
  if not private.is_staff(array['admin', 'account']::public.user_role[]) then return null; end if;
  if v_partner is not null and not private.can_manage_partner(v_partner) then return null; end if;
  if v_kind not in ('offer', 'proforma') or jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_items) not between 1 and 200 then
    raise exception 'Invalid document' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) i where (i->>'quantity') !~ '^[1-9]\d{0,5}$'
      or (nullif(i->>'discount_percent', '') is not null and (i->>'discount_percent') !~ '^\d{1,2}(\.\d{1,2})?$')) then
    raise exception 'Invalid quantity or discount' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) i left join public.products p on p.id = (i->>'product_id')::uuid
      where p.id is null or p.list_price is null) then
    raise exception 'Product without a BOCP price' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.sales_documents (kind, account_id, partner_id, client_name) values (v_kind, (select auth.uid()), v_partner, 'x')
      returning id into v_id;
  else
    select * into v_current from public.sales_documents where id = v_id for update;
    if not found or not private.owns_document(v_current)
      or not (v_current.status = 'draft' or (v_current.status = 'issued' and v_current.kind = 'offer')) then
      return null;
    end if;
    -- An issued offer keeps its kind.
    if v_current.status = 'issued' then v_kind := 'offer'; end if;
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
  insert into public.sales_document_items (document_id, product_id, sku, name, quantity, unit_price, vat_percent, discount_percent, position)
    select v_id, p.id, p.sku, p.name, (i.value->>'quantity')::integer, p.list_price, coalesce(p.vat_percent, 21),
      nullif(i.value->>'discount_percent', '')::numeric, i.ordinality
    from jsonb_array_elements(p_items) with ordinality i join public.products p on p.id = (i.value->>'product_id')::uuid;
  return v_id;
end
$$;

create or replace function private.offer_to_proforma(p_id uuid)
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
  insert into public.sales_document_items (document_id, product_id, sku, name, quantity, unit_price, vat_percent, discount_percent, position)
    select v_new, product_id, sku, name, quantity, unit_price, vat_percent, discount_percent, position from public.sales_document_items where document_id = p_id;
  return v_new;
end
$$;
