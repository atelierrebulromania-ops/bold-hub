-- HoReCa catalogs (Cataloage HoReCa): price-list catalogs exported as PDF from one fixed, app-controlled
-- template. Independent from Shopify, BOCP and the product catalog: a catalog keeps its own copy of the
-- products it shows. Only active administrators and catalog editors can read or change anything here,
-- checked by row security on the tables and on the images bucket (not just by hiding the menu).

-- Compared as text, so this migration does not depend on the enum value existing yet.
create function private.can_edit_horeca_catalogs() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select private.current_role())::text in ('admin', 'catalog_editor'), false) $$;
revoke all on function private.can_edit_horeca_catalogs() from public, anon;
grant execute on function private.can_edit_horeca_catalogs() to authenticated;

create table public.horeca_catalogs (
  id uuid primary key default gen_random_uuid(),
  title text not null constraint horeca_catalogs_title_check check (char_length(btrim(title)) between 1 and 120),
  language text not null default 'ro' constraint horeca_catalogs_language_check check (language in ('ro', 'es', 'en', 'fr', 'it', 'de')),
  currency text not null default 'RON' constraint horeca_catalogs_currency_check check (currency ~ '^[A-Z]{3}$'),
  cover_title text not null default 'HO RE CA' constraint horeca_catalogs_cover_title_check check (char_length(cover_title) <= 40),
  cover_subtitle text not null default '' constraint horeca_catalogs_cover_subtitle_check check (char_length(cover_subtitle) <= 60),
  website text not null default 'www.atelierrebul.ro' constraint horeca_catalogs_website_check check (char_length(website) <= 80),
  terms_vat text constraint horeca_catalogs_terms_vat_check check (char_length(terms_vat) <= 600),
  terms_currency text constraint horeca_catalogs_terms_currency_check check (char_length(terms_currency) <= 600),
  terms_payment text constraint horeca_catalogs_terms_payment_check check (char_length(terms_payment) <= 600),
  terms_delivery text constraint horeca_catalogs_terms_delivery_check check (char_length(terms_delivery) <= 600),
  terms_other text constraint horeca_catalogs_terms_other_check check (char_length(terms_other) <= 600),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.app_users(id) on delete set null
);

create table public.horeca_catalog_collections (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references public.horeca_catalogs(id) on delete cascade,
  label text not null default '' constraint horeca_collections_label_check check (char_length(label) <= 60),
  name text not null constraint horeca_collections_name_check check (char_length(btrim(name)) between 1 and 60),
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, catalog_id)
);
create index horeca_collections_catalog_idx on public.horeca_catalog_collections (catalog_id, position);

create table public.horeca_catalog_products (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references public.horeca_catalogs(id) on delete cascade,
  collection_id uuid not null,
  name text not null constraint horeca_products_name_check check (char_length(btrim(name)) between 1 and 80),
  price numeric(12, 2) not null constraint horeca_products_price_check check (price >= 0 and price < 1000000000),
  -- Null: the catalog's currency.
  currency text constraint horeca_products_currency_check check (currency ~ '^[A-Z]{3}$'),
  size_value numeric(10, 2) constraint horeca_products_size_value_check check (size_value > 0),
  size_unit text constraint horeca_products_size_unit_check check (size_unit in ('ml', 'g', 'kg', 'buc')),
  sku text constraint horeca_products_sku_check check (char_length(sku) <= 40),
  -- "seed/<file>" for the images shipped with the app, "catalogs/<catalog id>/<uuid>.<ext>" in the bucket.
  image_path text constraint horeca_products_image_path_check
    check (image_path ~ '^(seed/[A-Za-z0-9_-][A-Za-z0-9._-]{0,79}|catalogs/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png))$'),
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint horeca_products_size_pair_check check ((size_value is null) = (size_unit is null)),
  -- The product's collection always belongs to the same catalog.
  foreign key (collection_id, catalog_id) references public.horeca_catalog_collections (id, catalog_id) on delete cascade
);
create index horeca_products_collection_idx on public.horeca_catalog_products (collection_id, position);
create index horeca_products_catalog_idx on public.horeca_catalog_products (catalog_id);
create index horeca_products_image_idx on public.horeca_catalog_products (image_path) where image_path is not null;

alter table public.horeca_catalogs enable row level security;
alter table public.horeca_catalog_collections enable row level security;
alter table public.horeca_catalog_products enable row level security;
create policy catalog_editors on public.horeca_catalogs for all to authenticated
  using ((select private.can_edit_horeca_catalogs())) with check ((select private.can_edit_horeca_catalogs()));
create policy catalog_editors on public.horeca_catalog_collections for all to authenticated
  using ((select private.can_edit_horeca_catalogs())) with check ((select private.can_edit_horeca_catalogs()));
create policy catalog_editors on public.horeca_catalog_products for all to authenticated
  using ((select private.can_edit_horeca_catalogs())) with check ((select private.can_edit_horeca_catalogs()));
revoke all on public.horeca_catalogs, public.horeca_catalog_collections, public.horeca_catalog_products from anon;
grant select, insert, update, delete on public.horeca_catalogs, public.horeca_catalog_collections, public.horeca_catalog_products to authenticated;

-- "Last modified" on the catalog follows every change to its collections and products.
create function private.touch_horeca_catalog() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.horeca_catalogs set updated_at = now(), updated_by = coalesce((select auth.uid()), updated_by)
    where id = coalesce(new.catalog_id, old.catalog_id);
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return coalesce(new, old);
end
$$;
revoke all on function private.touch_horeca_catalog() from public, anon, authenticated;
create trigger horeca_collections_touch before insert or update or delete on public.horeca_catalog_collections
  for each row execute function private.touch_horeca_catalog();
create trigger horeca_products_touch before insert or update or delete on public.horeca_catalog_products
  for each row execute function private.touch_horeca_catalog();

-- Duplicate: an independent copy (collections, products, commercial data). Images are shared by path and
-- never overwritten (a new photo always gets a new path), so the copies stay independent.
create function private.duplicate_horeca_catalog(p_catalog_id uuid, p_title text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_new uuid;
  v_title text := nullif(btrim(p_title), '');
begin
  if not (select private.can_edit_horeca_catalogs()) then raise exception 'Access denied' using errcode = '42501'; end if;
  insert into public.horeca_catalogs (title, language, currency, cover_title, cover_subtitle, website,
      terms_vat, terms_currency, terms_payment, terms_delivery, terms_other, created_by, updated_by)
    select coalesce(v_title, left(c.title || ' (copie)', 120)), c.language, c.currency, c.cover_title, c.cover_subtitle, c.website,
      c.terms_vat, c.terms_currency, c.terms_payment, c.terms_delivery, c.terms_other, (select auth.uid()), (select auth.uid())
    from public.horeca_catalogs c where c.id = p_catalog_id
    returning id into v_new;
  if v_new is null then raise exception 'Catalog not found' using errcode = 'P0002'; end if;

  -- One statement: the id map is computed once (a data-modifying CTE always runs) and the
  -- foreign keys are checked at the end of the statement, after both inserts.
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

-- Reorder in one transaction: positions follow the order of the ids given.
create function private.reorder_horeca_products(p_collection_id uuid, p_product_ids uuid[]) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not (select private.can_edit_horeca_catalogs()) then return false; end if;
  -- The list must be exactly this collection's products, each once.
  if coalesce(cardinality(p_product_ids), 0) <> (select count(distinct x.pid) from unnest(p_product_ids) x(pid))
    or (select count(distinct x.pid) from unnest(p_product_ids) x(pid)
        join public.horeca_catalog_products p on p.id = x.pid and p.collection_id = p_collection_id)
      <> (select count(*) from public.horeca_catalog_products where collection_id = p_collection_id) then
    return false;
  end if;
  update public.horeca_catalog_products p set position = o.ord
    from unnest(p_product_ids) with ordinality o(pid, ord) where p.id = o.pid;
  return true;
end
$$;

create function private.reorder_horeca_collections(p_catalog_id uuid, p_collection_ids uuid[]) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not (select private.can_edit_horeca_catalogs()) then return false; end if;
  if coalesce(cardinality(p_collection_ids), 0) <> (select count(distinct x.cid) from unnest(p_collection_ids) x(cid))
    or (select count(distinct x.cid) from unnest(p_collection_ids) x(cid)
        join public.horeca_catalog_collections c on c.id = x.cid and c.catalog_id = p_catalog_id)
      <> (select count(*) from public.horeca_catalog_collections where catalog_id = p_catalog_id) then
    return false;
  end if;
  update public.horeca_catalog_collections c set position = o.ord
    from unnest(p_collection_ids) with ordinality o(cid, ord) where c.id = o.cid;
  return true;
end
$$;

revoke all on function private.duplicate_horeca_catalog(uuid, text) from public, anon;
revoke all on function private.reorder_horeca_products(uuid, uuid[]) from public, anon;
revoke all on function private.reorder_horeca_collections(uuid, uuid[]) from public, anon;
grant execute on function private.duplicate_horeca_catalog(uuid, text) to authenticated;
grant execute on function private.reorder_horeca_products(uuid, uuid[]) to authenticated;
grant execute on function private.reorder_horeca_collections(uuid, uuid[]) to authenticated;

create function public.duplicate_horeca_catalog(p_catalog_id uuid, p_title text) returns uuid
language sql security invoker set search_path = '' as $$ select private.duplicate_horeca_catalog(p_catalog_id, p_title) $$;
create function public.reorder_horeca_products(p_collection_id uuid, p_product_ids uuid[]) returns boolean
language sql security invoker set search_path = '' as $$ select private.reorder_horeca_products(p_collection_id, p_product_ids) $$;
create function public.reorder_horeca_collections(p_catalog_id uuid, p_collection_ids uuid[]) returns boolean
language sql security invoker set search_path = '' as $$ select private.reorder_horeca_collections(p_catalog_id, p_collection_ids) $$;
revoke all on function public.duplicate_horeca_catalog(uuid, text) from public, anon;
revoke all on function public.reorder_horeca_products(uuid, uuid[]) from public, anon;
revoke all on function public.reorder_horeca_collections(uuid, uuid[]) from public, anon;
grant execute on function public.duplicate_horeca_catalog(uuid, text) to authenticated;
grant execute on function public.reorder_horeca_products(uuid, uuid[]) to authenticated;
grant execute on function public.reorder_horeca_collections(uuid, uuid[]) to authenticated;

-- Product photos: private bucket, reachable only by catalog editors and administrators (the app streams
-- them after the same check). JPEG/PNG only, at most 8 MB; the browser resizes before uploading.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('horeca-catalog-images', 'horeca-catalog-images', false, 8388608, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy horeca_catalog_images_read on storage.objects for select to authenticated
  using (bucket_id = 'horeca-catalog-images' and (select private.can_edit_horeca_catalogs()));
create policy horeca_catalog_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'horeca-catalog-images' and (select private.can_edit_horeca_catalogs())
    and name ~ '^catalogs/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png)$');
create policy horeca_catalog_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'horeca-catalog-images' and (select private.can_edit_horeca_catalogs()));
