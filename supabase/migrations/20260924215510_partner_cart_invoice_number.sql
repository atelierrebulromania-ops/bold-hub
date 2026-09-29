-- "Facturat" now requires the BOCP invoice number, kept for later checks.
alter table public.partner_carts add column invoice_number text
  check (invoice_number is null or char_length(invoice_number) between 1 and 60);

drop function public.mark_partner_cart_invoiced(uuid);
drop function private.mark_partner_cart_invoiced(uuid);

create function private.mark_partner_cart_invoiced(p_cart_id uuid, p_invoice_number text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare v_number text := nullif(btrim(p_invoice_number), '');
begin
  if (select auth.uid()) is null
    or not coalesce((select private.current_role()) in ('admin', 'operator_facturare'), false) then
    return false;
  end if;
  if v_number is null or char_length(v_number) > 60 then return false; end if;
  update public.partner_carts
    set invoiced_at = now(), invoiced_by = (select auth.uid()), invoice_number = v_number
    where id = p_cart_id and status = 'delivered' and invoiced_at is null;
  return found;
end
$$;

create function public.mark_partner_cart_invoiced(p_cart_id uuid, p_invoice_number text)
returns boolean language sql security invoker set search_path = ''
as $$ select private.mark_partner_cart_invoiced(p_cart_id, p_invoice_number) $$;

revoke all on function private.mark_partner_cart_invoiced(uuid, text) from public, anon;
grant execute on function private.mark_partner_cart_invoiced(uuid, text) to authenticated;
revoke all on function public.mark_partner_cart_invoiced(uuid, text) from public, anon;
grant execute on function public.mark_partner_cart_invoiced(uuid, text) to authenticated;
