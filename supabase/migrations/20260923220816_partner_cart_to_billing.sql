-- The hand-off of a prepared partner cart is the moment it goes to billing: billing is
-- notified and sees which products go to which partner. The cart counts as delivered for
-- the partner's shelf and the reserved stock is released, as before.
drop function public.hand_partner_cart_to_courier(uuid);
drop function private.hand_partner_cart_to_courier(uuid);

create function private.hand_partner_cart_to_billing(p_cart_id uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_partner text;
  v_units integer;
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
  select p.business_name, (select sum(i.quantity_needed) from public.partner_cart_items i where i.cart_id = c.id)
    into v_partner, v_units
    from public.partner_carts c join public.partners p on p.id = c.partner_id where c.id = p_cart_id;
  perform private.notify('operator_facturare', 'predare_facturare',
    'Predare spre facturare: ' || v_partner || ' — ' || coalesce(v_units, 0) || ' buc. Emite factura.',
    'partner_cart', p_cart_id);
  return true;
end
$$;
revoke all on function private.hand_partner_cart_to_billing(uuid) from public, anon;
grant execute on function private.hand_partner_cart_to_billing(uuid) to authenticated;

create function public.hand_partner_cart_to_billing(p_cart_id uuid) returns boolean
language sql security invoker set search_path = ''
as $$ select private.hand_partner_cart_to_billing(p_cart_id) $$;
revoke all on function public.hand_partner_cart_to_billing(uuid) from public, anon;
grant execute on function public.hand_partner_cart_to_billing(uuid) to authenticated;
