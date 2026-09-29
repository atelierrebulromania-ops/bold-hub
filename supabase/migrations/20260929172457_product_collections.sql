-- Product collections (like Shopify collections): named product lists the agents reuse to fill
-- offers and proformas. Every agent sees them; the creator (or the admin) edits them.
create table public.product_collections (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_collection_items (
  collection_id uuid not null references public.product_collections(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  position integer not null default 0,
  primary key (collection_id, product_id)
);
create index product_collection_items_product_idx on public.product_collection_items (product_id);

alter table public.product_collections enable row level security;
alter table public.product_collection_items enable row level security;
create policy staff_read on public.product_collections for select
  using ((select private.current_role()) in ('admin', 'account'));
create policy staff_read on public.product_collection_items for select
  using ((select private.current_role()) in ('admin', 'account'));

-- Creates (p_id null) or replaces a collection: its name and its products, in order.
create function private.save_product_collection(p_id uuid, p_name text, p_product_ids uuid[])
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
      where id = v_id and (created_by = (select auth.uid()) or coalesce((select private.current_role()) = 'admin', false));
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

create function private.delete_product_collection(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not private.is_staff(array['admin', 'account']::public.user_role[]) then return false; end if;
  delete from public.product_collections
    where id = p_id and (created_by = (select auth.uid()) or coalesce((select private.current_role()) = 'admin', false));
  return found;
end
$$;

create function public.save_product_collection(p_id uuid, p_name text, p_product_ids uuid[]) returns uuid
language sql security invoker set search_path = '' as $$ select private.save_product_collection(p_id, p_name, p_product_ids) $$;
create function public.delete_product_collection(p_id uuid) returns boolean
language sql security invoker set search_path = '' as $$ select private.delete_product_collection(p_id) $$;

do $$
declare f text;
begin
  foreach f in array array[
    'private.save_product_collection(uuid, text, uuid[])', 'private.delete_product_collection(uuid)',
    'public.save_product_collection(uuid, text, uuid[])', 'public.delete_product_collection(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
