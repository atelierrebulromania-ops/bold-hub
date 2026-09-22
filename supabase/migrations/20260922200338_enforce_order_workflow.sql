-- Authenticated operators may read orders, but progress changes must go through
-- narrow RPCs that enforce status, ownership, and the scanned EAN atomically.
revoke update on public.online_orders, public.online_order_items from authenticated;

create function private.claim_online_order(p_order_id uuid) returns boolean
language sql security definer set search_path = ''
as $$
  with changed as (
    update public.online_orders
    set status = 'claimed', claimed_by = (select auth.uid()), claimed_at = now(), released_at = null
    where id = p_order_id and status = 'pending' and claimed_by is null
      and (select auth.uid()) is not null
      and (select private.current_role()) in ('admin', 'operator_depozit')
    returning id
  )
  select exists (select 1 from changed)
$$;

create function private.release_online_order(p_order_id uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or (select private.current_role()) not in ('admin', 'operator_depozit') then
    return false;
  end if;
  perform 1 from public.online_orders
    where id = p_order_id and claimed_by = (select auth.uid()) and status in ('claimed', 'preparing')
    for update;
  if not found then return false; end if;
  update public.online_order_items set scanned_quantity = 0 where order_id = p_order_id;
  update public.online_orders
    set status = 'pending', claimed_by = null, claimed_at = null, released_at = now()
    where id = p_order_id and claimed_by = (select auth.uid());
  return found;
end
$$;

create function private.scan_online_order_item(p_order_id uuid, p_ean text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_item_id uuid;
begin
  if (select auth.uid()) is null or (select private.current_role()) not in ('admin', 'operator_depozit') then
    return false;
  end if;
  perform 1 from public.online_orders
    where id = p_order_id and claimed_by = (select auth.uid()) and status in ('claimed', 'preparing')
    for update;
  if not found then return false; end if;
  select i.id into v_item_id from public.online_order_items i
    where i.order_id = p_order_id and i.ean = trim(p_ean) and i.scanned_quantity < i.quantity
    order by i.created_at, i.id limit 1 for update;
  if v_item_id is null then return false; end if;
  update public.online_orders set status = 'preparing' where id = p_order_id;
  update public.online_order_items set scanned_quantity = scanned_quantity + 1 where id = v_item_id;
  return found;
end
$$;

create function private.mark_online_order_ready(p_order_id uuid) returns boolean
language sql security definer set search_path = ''
as $$
  with changed as (
    update public.online_orders o set status = 'ready'
    where o.id = p_order_id and o.claimed_by = (select auth.uid())
      and (select auth.uid()) is not null
      and o.status in ('claimed', 'preparing')
      and (select private.current_role()) in ('admin', 'operator_depozit')
      and exists (select 1 from public.online_order_items i where i.order_id = o.id)
      and not exists (select 1 from public.online_order_items i
        where i.order_id = o.id and i.scanned_quantity < i.quantity)
    returning id
  )
  select exists (select 1 from changed)
$$;

create function private.hand_online_order_to_courier(p_order_id uuid) returns boolean
language sql security definer set search_path = ''
as $$
  with changed as (
    update public.online_orders set status = 'handed_to_courier', completed_at = now()
    where id = p_order_id and claimed_by = (select auth.uid())
      and (select auth.uid()) is not null and status = 'ready'
      and (select private.current_role()) in ('admin', 'operator_depozit')
    returning id
  )
  select exists (select 1 from changed)
$$;

revoke all on function private.claim_online_order(uuid) from public, anon;
revoke all on function private.release_online_order(uuid) from public, anon;
revoke all on function private.scan_online_order_item(uuid, text) from public, anon;
revoke all on function private.mark_online_order_ready(uuid) from public, anon;
revoke all on function private.hand_online_order_to_courier(uuid) from public, anon;
grant execute on function private.claim_online_order(uuid) to authenticated;
grant execute on function private.release_online_order(uuid) to authenticated;
grant execute on function private.scan_online_order_item(uuid, text) to authenticated;
grant execute on function private.mark_online_order_ready(uuid) to authenticated;
grant execute on function private.hand_online_order_to_courier(uuid) to authenticated;

create or replace function public.claim_online_order(p_order_id uuid) returns boolean
language sql security invoker set search_path = '' as $$ select private.claim_online_order(p_order_id) $$;
create or replace function public.release_online_order(p_order_id uuid) returns boolean
language sql security invoker set search_path = '' as $$ select private.release_online_order(p_order_id) $$;
create or replace function public.scan_online_order_item(p_order_id uuid, p_ean text) returns boolean
language sql security invoker set search_path = '' as $$ select private.scan_online_order_item(p_order_id, p_ean) $$;
create or replace function public.mark_online_order_ready(p_order_id uuid) returns boolean
language sql security invoker set search_path = '' as $$ select private.mark_online_order_ready(p_order_id) $$;
create or replace function public.hand_online_order_to_courier(p_order_id uuid) returns boolean
language sql security invoker set search_path = '' as $$ select private.hand_online_order_to_courier(p_order_id) $$;
