-- "De rezervat" in Facturare B2B: billing moves a cart's products into the BOCP "Rezervat"
-- warehouse and confirms it here, so it no longer relies on the notification alone.
alter table public.partner_carts
  add column reserved_in_bocp_at timestamptz,
  add column reserved_in_bocp_by uuid references public.app_users(id);

create index partner_carts_to_reserve_idx on public.partner_carts (prepared_at)
  where prepared_at is not null and reserved_in_bocp_at is null;

create function private.mark_partner_cart_reserved_in_bocp(p_cart_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if (select auth.uid()) is null
    or not coalesce((select private.current_role()) in ('admin', 'operator_facturare'), false) then
    return false;
  end if;
  update public.partner_carts set reserved_in_bocp_at = now(), reserved_in_bocp_by = (select auth.uid())
    where id = p_cart_id and status in ('prepared', 'delivered')
      and prepared_at is not null and reserved_in_bocp_at is null;
  return found;
end
$$;

create function public.mark_partner_cart_reserved_in_bocp(p_cart_id uuid)
returns boolean language sql security invoker set search_path = ''
as $$ select private.mark_partner_cart_reserved_in_bocp(p_cart_id) $$;

revoke all on function private.mark_partner_cart_reserved_in_bocp(uuid) from public, anon;
grant execute on function private.mark_partner_cart_reserved_in_bocp(uuid) to authenticated;
revoke all on function public.mark_partner_cart_reserved_in_bocp(uuid) from public, anon;
grant execute on function public.mark_partner_cart_reserved_in_bocp(uuid) to authenticated;
