-- The warehouse marks a partner's cart as prepared: the missing products are on the
-- reserved shelf and ready to deliver. It does not go to billing yet. A prepared cart
-- stops taking new items (the partner starts a new open cart) and its 48h countdown stops.
alter type public.cart_status add value if not exists 'prepared' after 'open';

alter table public.partner_carts
  add column prepared_at timestamptz,
  add column prepared_by uuid references public.app_users(id);
create index partner_carts_prepared_by_idx on public.partner_carts(prepared_by);

create function private.mark_partner_cart_prepared(p_cart_id uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_staff(array['admin', 'operator_depozit']::public.user_role[]) then return false; end if;
  update public.partner_carts c set status = 'prepared', prepared_at = now(), prepared_by = (select auth.uid())
    where c.id = p_cart_id and c.status = 'open'
      and exists (select 1 from public.partner_cart_items i where i.cart_id = c.id);
  return found;
end
$$;
revoke all on function private.mark_partner_cart_prepared(uuid) from public, anon;
grant execute on function private.mark_partner_cart_prepared(uuid) to authenticated;

create function public.mark_partner_cart_prepared(p_cart_id uuid) returns boolean
language sql security invoker set search_path = ''
as $$ select private.mark_partner_cart_prepared(p_cart_id) $$;
revoke all on function public.mark_partner_cart_prepared(uuid) from public, anon;
grant execute on function public.mark_partner_cart_prepared(uuid) to authenticated;

-- Prepared products are already ordered: a new shelf count must not order them again.
create or replace function private.submit_refill_counts(p_counts jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_partner_id uuid;
  v_items jsonb := '[]'::jsonb;
  v_row record;
begin
  select id into v_partner_id from public.partners where auth_user_id = (select auth.uid()) and active;
  if v_partner_id is null then raise exception 'Access denied' using errcode = '42501'; end if;
  if jsonb_typeof(p_counts) is distinct from 'array' or jsonb_array_length(p_counts) > 500 then
    raise exception 'Invalid counts' using errcode = '22023';
  end if;

  for v_row in
    select pl.product_id,
      pl.par_level_quantity - greatest(0, (c->>'remaining')::integer) - coalesce((
        select sum(i.quantity_needed) from public.partner_cart_items i
        join public.partner_carts rc on rc.id = i.cart_id
        where rc.partner_id = v_partner_id and rc.status::text in ('open', 'prepared', 'pending_delivery')
          and i.product_id = pl.product_id), 0) as needed
    from jsonb_array_elements(p_counts) c
    join public.partner_par_levels pl on pl.partner_id = v_partner_id and pl.product_id = (c->>'product_id')::uuid
    join public.products p on p.id = pl.product_id and p.active
    where (c->>'remaining') ~ '^\d{1,6}$'
  loop
    if v_row.needed > 0 then
      v_items := v_items || jsonb_build_object('product_id', v_row.product_id, 'quantity', v_row.needed);
    end if;
  end loop;

  if jsonb_array_length(v_items) = 0 then
    return jsonb_build_object('items', 0, 'units', 0);
  end if;
  return private.cart_add_items(v_partner_id, v_items, 'app');
end
$$;
