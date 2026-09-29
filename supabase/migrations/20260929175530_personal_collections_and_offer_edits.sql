-- Collections are each agent's own workflow: only their creator sees and edits them.
drop policy staff_read on public.product_collections;
drop policy staff_read on public.product_collection_items;
create policy own_collections on public.product_collections for select
  using ((select private.current_role()) in ('admin', 'account') and created_by = (select auth.uid()));
create policy own_collection_items on public.product_collection_items for select
  using (exists (select 1 from public.product_collections c where c.id = product_collection_items.collection_id));

create or replace function private.save_product_collection(p_id uuid, p_name text, p_product_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_id uuid := p_id;
begin
  if not private.is_staff(array['admin', 'account']::public.user_role[]) then return null; end if;
  if nullif(btrim(p_name), '') is null or char_length(btrim(p_name)) > 120
    or coalesce(array_length(p_product_ids, 1), 0) > 500 then
    raise exception 'Invalid collection' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.product_collections (name, created_by) values (btrim(p_name), (select auth.uid())) returning id into v_id;
  else
    update public.product_collections set name = btrim(p_name), updated_at = now()
      where id = v_id and created_by = (select auth.uid());
    if not found then return null; end if;
    delete from public.product_collection_items where collection_id = v_id;
  end if;
  insert into public.product_collection_items (collection_id, product_id, position)
    select v_id, p.id, min(i.ordinality)
    from unnest(coalesce(p_product_ids, '{}')) with ordinality i(product_id, ordinality)
    join public.products p on p.id = i.product_id
    group by p.id;
  return v_id;
end
$$;

create or replace function private.delete_product_collection(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not private.is_staff(array['admin', 'account']::public.user_role[]) then return false; end if;
  delete from public.product_collections where id = p_id and created_by = (select auth.uid());
  return found;
end
$$;

-- An issued offer stays editable (it keeps its number); proformas stay locked once issued in BOCP.
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
  insert into public.sales_document_items (document_id, product_id, sku, name, quantity, unit_price, vat_percent, position)
    select v_id, p.id, p.sku, p.name, (i.value->>'quantity')::integer, p.list_price, coalesce(p.vat_percent, 21), i.ordinality
    from jsonb_array_elements(p_items) with ordinality i join public.products p on p.id = (i.value->>'product_id')::uuid;
  return v_id;
end
$$;
