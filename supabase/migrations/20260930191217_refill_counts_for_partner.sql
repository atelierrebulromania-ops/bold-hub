-- The shelf-count request of a location, computed for a given partner. The partner submits its own;
-- the admin (previewing the location) or its agent may submit it on its behalf.
create function private.refill_counts_for(p_partner_id uuid, p_counts jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_items jsonb := '[]'::jsonb;
  v_row record;
begin
  if jsonb_typeof(p_counts) is distinct from 'array' or jsonb_array_length(p_counts) > 500 then
    raise exception 'Invalid counts' using errcode = '22023';
  end if;

  for v_row in
    select pl.product_id,
      pl.par_level_quantity - greatest(0, (c->>'remaining')::integer) - coalesce((
        select sum(i.quantity_needed) from public.partner_cart_items i
        join public.partner_carts rc on rc.id = i.cart_id
        where rc.partner_id = p_partner_id and rc.status::text in ('open', 'prepared', 'pending_delivery')
          and i.product_id = pl.product_id), 0) as needed
    from jsonb_array_elements(p_counts) c
    join public.partner_par_levels pl on pl.partner_id = p_partner_id and pl.product_id = (c->>'product_id')::uuid
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
  return private.cart_add_items(p_partner_id, v_items, 'app');
end
$$;

create or replace function private.submit_refill_counts(p_counts jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_partner_id uuid;
begin
  select id into v_partner_id from public.partners where auth_user_id = (select auth.uid()) and active;
  if v_partner_id is null then raise exception 'Access denied' using errcode = '42501'; end if;
  return private.refill_counts_for(v_partner_id, p_counts);
end
$$;

create function private.submit_refill_counts_for(p_partner_id uuid, p_counts jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not private.can_manage_partner(p_partner_id) then raise exception 'Access denied' using errcode = '42501'; end if;
  return private.refill_counts_for(p_partner_id, p_counts);
end
$$;

create function public.submit_refill_counts_for(p_partner_id uuid, p_counts jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.submit_refill_counts_for(p_partner_id, p_counts) $$;

revoke all on function private.refill_counts_for(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.submit_refill_counts_for(uuid, jsonb) from public, anon;
grant execute on function private.submit_refill_counts_for(uuid, jsonb) to authenticated;
revoke all on function public.submit_refill_counts_for(uuid, jsonb) from public, anon;
grant execute on function public.submit_refill_counts_for(uuid, jsonb) to authenticated;
