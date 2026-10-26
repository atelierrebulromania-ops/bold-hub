-- The BOCP error already ends with a period: do not add a second one in the billing notification.
CREATE OR REPLACE FUNCTION private.record_partner_cart_bocp_order(p_cart_id uuid, p_bocp_order_id text, p_error text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_partner text;
begin
  if not private.is_staff(array['admin', 'operator_depozit', 'operator_facturare']::public.user_role[]) then return false; end if;
  if p_bocp_order_id is not null then
    update public.partner_carts set bocp_order_id = p_bocp_order_id, bocp_order_error = null,
      bocp_order_attempted_at = now(), reserved_in_bocp_at = coalesce(reserved_in_bocp_at, now()),
      reserved_in_bocp_by = coalesce(reserved_in_bocp_by, (select auth.uid()))
      where id = p_cart_id and status in ('prepared', 'delivered');
    return found;
  end if;
  update public.partner_carts set bocp_order_error = left(coalesce(nullif(btrim(p_error), ''), 'Eroare necunoscută'), 500),
    bocp_order_attempted_at = now()
    where id = p_cart_id and status in ('prepared', 'delivered') and reserved_in_bocp_at is null;
  if not found then return false; end if;
  select p.business_name into v_partner
    from public.partner_carts c join public.partners p on p.id = c.partner_id where c.id = p_cart_id;
  perform private.notify('operator_facturare', 'rezervare_bocp_esuata',
    'Rezervarea în BOCP nu a reușit pentru ' || v_partner || ': ' || rtrim(left(btrim(coalesce(p_error, '')), 200), '.') || '. Reîncearcă din Facturare B2B → Rezervare.',
    'partner_cart', p_cart_id);
  return true;
end
$function$;
