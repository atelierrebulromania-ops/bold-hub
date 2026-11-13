-- HoReCa catalogs: a discount per catalog, in percent. It is applied when the catalog is shown (editor and
-- PDF: the list price struck through, the discounted price next to it); product prices stay as entered.
alter table public.horeca_catalogs
  add column discount_percent numeric(5, 2) not null default 0
  constraint horeca_catalogs_discount_check check (discount_percent >= 0 and discount_percent < 100);

-- A duplicate keeps the discount (same body as before, plus discount_percent).
create or replace function private.duplicate_horeca_catalog(p_catalog_id uuid, p_title text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_new uuid;
  v_title text := nullif(btrim(p_title), '');
begin
  if not (select private.can_edit_horeca_catalogs()) then raise exception 'Access denied' using errcode = '42501'; end if;
  insert into public.horeca_catalogs (title, language, currency, cover_title, cover_subtitle, website,
      terms_vat, terms_currency, terms_payment, terms_delivery, terms_other, discount_percent, created_by, updated_by)
    select coalesce(v_title, left(c.title || ' (copie)', 120)), c.language, c.currency, c.cover_title, c.cover_subtitle, c.website,
      c.terms_vat, c.terms_currency, c.terms_payment, c.terms_delivery, c.terms_other, c.discount_percent, (select auth.uid()), (select auth.uid())
    from public.horeca_catalogs c where c.id = p_catalog_id
    returning id into v_new;
  if v_new is null then raise exception 'Catalog not found' using errcode = 'P0002'; end if;

  with map as materialized (
    select id as old_id, gen_random_uuid() as new_id from public.horeca_catalog_collections where catalog_id = p_catalog_id
  ), copied as (
    insert into public.horeca_catalog_collections (id, catalog_id, label, name, position, active)
      select m.new_id, v_new, c.label, c.name, c.position, c.active
      from public.horeca_catalog_collections c join map m on m.old_id = c.id
  )
  insert into public.horeca_catalog_products (catalog_id, collection_id, name, price, currency, size_value, size_unit, sku, image_path, position, active)
    select v_new, m.new_id, p.name, p.price, p.currency, p.size_value, p.size_unit, p.sku, p.image_path, p.position, p.active
    from public.horeca_catalog_products p join map m on m.old_id = p.collection_id
    where p.catalog_id = p_catalog_id;
  return v_new;
end
$$;
