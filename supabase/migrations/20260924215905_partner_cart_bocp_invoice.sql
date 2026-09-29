-- "Facturat" is linked to the invoice found in BOCP (id, date, PDF), so it can be checked and
-- downloaded from the billing history.
alter table public.partner_carts
  add column bocp_invoice_id text check (bocp_invoice_id is null or bocp_invoice_id ~ '^[1-9][0-9]{0,18}$'),
  add column invoice_date date,
  add column invoice_pdf_url text check (invoice_pdf_url is null or invoice_pdf_url ~ '^https://secure\.bocp\.eu/');

drop function public.mark_partner_cart_invoiced(uuid, text);
drop function private.mark_partner_cart_invoiced(uuid, text);

create function private.mark_partner_cart_invoiced(p_cart_id uuid, p_invoice_number text,
  p_bocp_invoice_id text, p_invoice_date date, p_invoice_pdf_url text)
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
  if v_number is null or char_length(v_number) > 60
    or p_bocp_invoice_id !~ '^[1-9][0-9]{0,18}$' or p_invoice_date is null
    or (p_invoice_pdf_url is not null and p_invoice_pdf_url !~ '^https://secure\.bocp\.eu/') then
    return false;
  end if;
  update public.partner_carts
    set invoiced_at = now(), invoiced_by = (select auth.uid()), invoice_number = v_number,
      bocp_invoice_id = p_bocp_invoice_id, invoice_date = p_invoice_date, invoice_pdf_url = p_invoice_pdf_url
    where id = p_cart_id and status = 'delivered' and invoiced_at is null;
  return found;
end
$$;

create function public.mark_partner_cart_invoiced(p_cart_id uuid, p_invoice_number text,
  p_bocp_invoice_id text, p_invoice_date date, p_invoice_pdf_url text)
returns boolean language sql security invoker set search_path = ''
as $$ select private.mark_partner_cart_invoiced(p_cart_id, p_invoice_number, p_bocp_invoice_id, p_invoice_date, p_invoice_pdf_url) $$;

revoke all on function private.mark_partner_cart_invoiced(uuid, text, text, date, text) from public, anon;
grant execute on function private.mark_partner_cart_invoiced(uuid, text, text, date, text) to authenticated;
revoke all on function public.mark_partner_cart_invoiced(uuid, text, text, date, text) from public, anon;
grant execute on function public.mark_partner_cart_invoiced(uuid, text, text, date, text) to authenticated;
