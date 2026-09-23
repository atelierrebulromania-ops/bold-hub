-- Billing gets one notification per partner hand-off, listing the products to invoice.
create or replace function private.hand_partner_cart_to_billing(p_cart_id uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_partner text;
  v_units integer;
  v_products text;
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
  select p.business_name into v_partner
    from public.partner_carts c join public.partners p on p.id = c.partner_id where c.id = p_cart_id;
  select sum(i.quantity_needed),
      string_agg(pr.name || coalesce(' · ' || pr.variant_label, '') || ' ×' || i.quantity_needed, '; ' order by pr.name)
    into v_units, v_products
    from public.partner_cart_items i join public.products pr on pr.id = i.product_id where i.cart_id = p_cart_id;
  perform private.notify('operator_facturare', 'predare_facturare',
    'Predare spre facturare: ' || v_partner || ' — ' || coalesce(v_units, 0) || ' buc.: ' || coalesce(v_products, '—') || '. Emite factura.',
    'partner_cart', p_cart_id);
  return true;
end
$$;
