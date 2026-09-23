-- A prepared partner cart is handed to the courier (own driver or external): it becomes
-- delivered, the partner's shelf counts as full again and the reserved stock is released.
alter table public.partner_carts add column delivered_by uuid references public.app_users(id);
create index partner_carts_delivered_by_idx on public.partner_carts(delivered_by);

create function private.hand_partner_cart_to_courier(p_cart_id uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_staff(array['admin', 'operator_depozit']::public.user_role[]) then return false; end if;
  update public.partner_carts set status = 'delivered', delivered_at = now(), delivered_by = (select auth.uid())
    where id = p_cart_id and status = 'prepared';
  if not found then return false; end if;
  update public.warehouse_stock s
    set quantity_reserved = greatest(0, s.quantity_reserved - t.units), updated_at = now()
    from (select product_id, sum(quantity_needed) as units from public.partner_cart_items
          where cart_id = p_cart_id group by product_id) t
    where s.product_id = t.product_id;
  return true;
end
$$;
revoke all on function private.hand_partner_cart_to_courier(uuid) from public, anon;
grant execute on function private.hand_partner_cart_to_courier(uuid) to authenticated;

create function public.hand_partner_cart_to_courier(p_cart_id uuid) returns boolean
language sql security invoker set search_path = ''
as $$ select private.hand_partner_cart_to_courier(p_cart_id) $$;
revoke all on function public.hand_partner_cart_to_courier(uuid) from public, anon;
grant execute on function public.hand_partner_cart_to_courier(uuid) to authenticated;
