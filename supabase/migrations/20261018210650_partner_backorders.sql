-- B2B backorders (restanțe): what the warehouse could not put at preparation. When stock returns the
-- warehouse shelves it; it then joins the partner's next prepared order (BOCP reservation + invoice).

create table public.partner_backorders (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity integer not null check (quantity > 0),
  status text not null default 'open' check (status in ('open', 'shelved', 'delivered', 'cancelled')),
  source_cart_id uuid references public.partner_carts(id) on delete set null,
  delivered_cart_id uuid references public.partner_carts(id) on delete set null,
  created_by uuid references public.app_users(id) on delete set null,
  shelved_at timestamptz,
  shelved_by uuid references public.app_users(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references public.app_users(id) on delete set null,
  cancel_reason text check (length(cancel_reason) <= 300),
  stock_notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index partner_backorders_partner_idx on public.partner_backorders (partner_id, status);
create index partner_backorders_open_idx on public.partner_backorders (product_id) where status = 'open';
alter table public.partner_backorders enable row level security;
create policy staff_read on public.partner_backorders for select to authenticated
  using ((select private.current_role()) in ('admin', 'operator_depozit', 'operator_facturare'));
create policy account_own on public.partner_backorders for select to authenticated
  using ((select private.current_role()) = 'account' and exists (select 1 from public.partners p where p.id = partner_id and p.account_id = (select auth.uid())));
create policy partner_own on public.partner_backorders for select to authenticated
  using (exists (select 1 from public.partners p where p.id = partner_id and p.auth_user_id = (select auth.uid()) and p.active));
alter publication supabase_realtime add table public.partner_backorders;

-- The warehouse prepares a cart with the quantities it actually put (p_lines: [{item_id, quantity}],
-- lines left out are put in full). Shortfalls become backorders; shelved backorders of the partner
-- join this cart. Returns 'prepared', 'empty' (nothing could be put) or 'changed'.
create or replace function private.prepare_partner_cart(p_cart_id uuid, p_lines jsonb)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_cart record;
  v_item record;
  v_qty integer;
  v_short integer;
  v_shorts text := '';
  v_back record;
begin
  if not private.is_staff(array['admin', 'operator_depozit']::public.user_role[]) then
    raise exception 'Warehouse access required' using errcode = '42501';
  end if;
  select c.id, c.partner_id, p.business_name, p.account_id into v_cart
    from public.partner_carts c join public.partners p on p.id = c.partner_id
    where c.id = p_cart_id and c.status = 'open' for update of c;
  if not found then return 'changed'; end if;

  for v_item in select i.id, i.product_id, i.quantity_needed, pr.name, pr.variant_label
      from public.partner_cart_items i join public.products pr on pr.id = i.product_id where i.cart_id = p_cart_id for update of i loop
    select (l->>'quantity')::integer into v_qty from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
      where l->>'item_id' = v_item.id::text and (l->>'quantity') ~ '^\d{1,6}$';
    v_qty := least(coalesce(v_qty, v_item.quantity_needed), v_item.quantity_needed);
    v_short := v_item.quantity_needed - v_qty;
    continue when v_short = 0;
    insert into public.partner_backorders (partner_id, product_id, quantity, source_cart_id, created_by)
      values (v_cart.partner_id, v_item.product_id, v_short, p_cart_id, (select auth.uid()));
    update public.warehouse_stock set quantity_reserved = greatest(0, quantity_reserved - v_short), updated_at = now()
      where product_id = v_item.product_id;
    if v_qty = 0 then
      update public.refill_requests set cart_item_id = null where cart_item_id = v_item.id;
      delete from public.partner_cart_items where id = v_item.id;
    else
      update public.partner_cart_items set quantity_needed = v_qty where id = v_item.id;
    end if;
    v_shorts := v_shorts || case when v_shorts = '' then '' else '; ' end
      || v_item.name || coalesce(' · ' || v_item.variant_label, '') || ' ×' || v_short;
  end loop;

  -- Backorders already on the partner's shelf leave with this order.
  for v_back in select id, product_id, quantity from public.partner_backorders
      where partner_id = v_cart.partner_id and status = 'shelved' for update loop
    update public.partner_cart_items set quantity_needed = quantity_needed + v_back.quantity
      where cart_id = p_cart_id and product_id = v_back.product_id;
    if not found then
      insert into public.partner_cart_items (cart_id, product_id, quantity_needed) values (p_cart_id, v_back.product_id, v_back.quantity);
    end if;
    update public.partner_backorders set status = 'delivered', delivered_cart_id = p_cart_id where id = v_back.id;
  end loop;

  if v_shorts <> '' and v_cart.account_id is not null then
    insert into public.notifications (recipient_user_id, type, message, related_entity_type, related_entity_id)
      values (v_cart.account_id, 'restanta_noua', left('Restanță la ' || v_cart.business_name || ': ' || v_shorts || '. Pleacă la următoarea livrare, când revine stocul.', 500), 'partner_cart', p_cart_id);
  end if;

  if not exists (select 1 from public.partner_cart_items where cart_id = p_cart_id) then
    update public.partner_carts set countdown_started_at = null where id = p_cart_id;
    return 'empty';
  end if;
  update public.partner_carts set status = 'prepared', prepared_at = now(), prepared_by = (select auth.uid()) where id = p_cart_id;
  return 'prepared';
end
$$;

-- Stock is back: the warehouse puts (part of) a backorder on the partner's shelf.
create or replace function private.shelve_backorder(p_id uuid, p_quantity integer)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare v_back record;
begin
  if not private.is_staff(array['admin', 'operator_depozit']::public.user_role[]) then
    raise exception 'Warehouse access required' using errcode = '42501';
  end if;
  select * into v_back from public.partner_backorders where id = p_id and status = 'open' for update;
  if not found or p_quantity is null or p_quantity < 1 or p_quantity > v_back.quantity then return false; end if;
  if p_quantity < v_back.quantity then
    update public.partner_backorders set quantity = quantity - p_quantity where id = p_id;
    insert into public.partner_backorders (partner_id, product_id, quantity, status, source_cart_id, created_by, created_at, shelved_at, shelved_by)
      values (v_back.partner_id, v_back.product_id, p_quantity, 'shelved', v_back.source_cart_id, v_back.created_by, v_back.created_at, now(), (select auth.uid()));
  else
    update public.partner_backorders set status = 'shelved', shelved_at = now(), shelved_by = (select auth.uid()) where id = p_id;
  end if;
  insert into public.warehouse_stock (product_id, quantity_reserved) values (v_back.product_id, p_quantity)
    on conflict (product_id) do update set quantity_reserved = public.warehouse_stock.quantity_reserved + excluded.quantity_reserved, updated_at = now();
  return true;
end
$$;

-- The agent (own client) or the admin drops a backorder.
create or replace function private.cancel_backorder(p_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare v_back record;
begin
  select * into v_back from public.partner_backorders where id = p_id and status in ('open', 'shelved') for update;
  if not found then return false; end if;
  if not (private.is_staff(array['admin']::public.user_role[]) or
    ((select private.current_role()) = 'account' and exists (select 1 from public.partners p where p.id = v_back.partner_id and p.account_id = (select auth.uid())))) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Reason required' using errcode = '22023'; end if;
  update public.partner_backorders set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()),
    cancel_reason = left(trim(p_reason), 300) where id = p_id;
  if v_back.status = 'shelved' then
    update public.warehouse_stock set quantity_reserved = greatest(0, quantity_reserved - v_back.quantity), updated_at = now()
      where product_id = v_back.product_id;
  end if;
  return true;
end
$$;

-- Scheduled (service role): products with open backorders, for the morning BOCP stock check.
create or replace function private.backorder_products()
returns table (product_id uuid, sku text, name text, units bigint, partners bigint, unnotified bigint)
language sql
stable
security definer
set search_path to ''
as $$
  select b.product_id, p.sku, p.name || coalesce(' · ' || p.variant_label, ''), sum(b.quantity), count(distinct b.partner_id),
    count(*) filter (where b.stock_notified_at is null)
  from public.partner_backorders b join public.products p on p.id = b.product_id
  where b.status = 'open' and (select auth.role()) = 'service_role'
  group by b.product_id, p.sku, p.name, p.variant_label
$$;

-- Scheduled: stock is back for these products — tell the warehouse once per backorder.
create or replace function private.notify_backorder_stock(p_items jsonb)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare v_item jsonb; v_count integer := 0;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'Service access required' using errcode = '42501'; end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    update public.partner_backorders set stock_notified_at = now()
      where product_id = (v_item->>'product_id')::uuid and status = 'open' and stock_notified_at is null;
    if found then
      perform private.notify('operator_depozit', 'restanta_stoc',
        'A revenit stocul pentru ' || (v_item->>'name') || ' (disponibil ' || (v_item->>'available') || '): restanțe de ' || (v_item->>'units')
        || ' buc. la ' || (v_item->>'partners') || ' parteneri. Pune-le pe raft din Comenzi B2B → Restanțe.', 'backorder', null);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end
$$;

-- The partner's next count does not ask again for what is owed (open or on the shelf).
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname = 'refill_counts_for';
  if position($x$and i.product_id = pl.product_id), 0) as needed$x$ in v_def) = 0 then raise exception 'refill_counts_for changed'; end if;
  v_def := replace(v_def, $x$and i.product_id = pl.product_id), 0) as needed$x$,
    $x$and i.product_id = pl.product_id), 0) - coalesce((
        select sum(b.quantity) from public.partner_backorders b
        where b.partner_id = p_partner_id and b.product_id = pl.product_id and b.status in ('open', 'shelved')), 0) as needed$x$);
  execute v_def;
end
$$;

create or replace function public.prepare_partner_cart(p_cart_id uuid, p_lines jsonb) returns text language sql security invoker set search_path to ''
as $$ select private.prepare_partner_cart(p_cart_id, p_lines) $$;
create or replace function public.shelve_backorder(p_id uuid, p_quantity integer) returns boolean language sql security invoker set search_path to ''
as $$ select private.shelve_backorder(p_id, p_quantity) $$;
create or replace function public.cancel_backorder(p_id uuid, p_reason text) returns boolean language sql security invoker set search_path to ''
as $$ select private.cancel_backorder(p_id, p_reason) $$;
create or replace function public.backorder_products() returns table (product_id uuid, sku text, name text, units bigint, partners bigint, unnotified bigint)
language sql stable security invoker set search_path to '' as $$ select * from private.backorder_products() $$;
create or replace function public.notify_backorder_stock(p_items jsonb) returns integer language sql security invoker set search_path to ''
as $$ select private.notify_backorder_stock(p_items) $$;

revoke all on function private.prepare_partner_cart(uuid, jsonb), private.shelve_backorder(uuid, integer), private.cancel_backorder(uuid, text),
  private.backorder_products(), private.notify_backorder_stock(jsonb), public.prepare_partner_cart(uuid, jsonb), public.shelve_backorder(uuid, integer),
  public.cancel_backorder(uuid, text), public.backorder_products(), public.notify_backorder_stock(jsonb) from public, anon, authenticated;
grant execute on function private.prepare_partner_cart(uuid, jsonb), private.shelve_backorder(uuid, integer), private.cancel_backorder(uuid, text),
  public.prepare_partner_cart(uuid, jsonb), public.shelve_backorder(uuid, integer), public.cancel_backorder(uuid, text) to authenticated;
grant execute on function private.backorder_products(), private.notify_backorder_stock(jsonb), public.backorder_products(), public.notify_backorder_stock(jsonb) to service_role;
