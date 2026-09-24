-- Reserving a cart on the shelf tells billing to move those units from the global stock
-- into the BOCP "Rezervat" warehouse, so the global stock excludes what is bound for partners.
create or replace function private.mark_partner_cart_prepared(p_cart_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_partner text;
  v_units integer;
  v_products text;
begin
  if not private.is_staff(array['admin', 'operator_depozit']::public.user_role[]) then return false; end if;
  update public.partner_carts c set status = 'prepared', prepared_at = now(), prepared_by = (select auth.uid())
    where c.id = p_cart_id and c.status = 'open'
      and exists (select 1 from public.partner_cart_items i where i.cart_id = c.id);
  if not found then return false; end if;
  select p.business_name into v_partner
    from public.partner_carts c join public.partners p on p.id = c.partner_id where c.id = p_cart_id;
  select sum(t.units),
      string_agg(t.label || ' ×' || t.units, '; ' order by t.label)
    into v_units, v_products
    from (select pr.name || coalesce(' · ' || pr.variant_label, '') || coalesce(' (' || pr.sku || ')', '') as label,
            sum(i.quantity_needed) as units
          from public.partner_cart_items i join public.products pr on pr.id = i.product_id
          where i.cart_id = p_cart_id group by pr.id, pr.name, pr.variant_label, pr.sku) t;
  perform private.notify('operator_facturare', 'rezervare_stoc',
    'Produse rezervate pe raft: ' || v_partner || ' — ' || coalesce(v_units, 0) || ' buc.: ' || coalesce(v_products, '—')
      || '. Mută-le din stocul global în gestiunea Rezervat din BOCP.',
    'partner_cart', p_cart_id);
  return true;
end
$$;
