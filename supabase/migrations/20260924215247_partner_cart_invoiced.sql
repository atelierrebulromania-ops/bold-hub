-- "Facturare B2B": billing issues the invoice in BOCP, then marks the handed cart "Facturat" here.
alter table public.partner_carts
  add column invoiced_at timestamptz,
  add column invoiced_by uuid references public.app_users(id);

create index partner_carts_to_invoice_idx on public.partner_carts (delivered_at)
  where status = 'delivered' and invoiced_at is null;

create function private.mark_partner_cart_invoiced(p_cart_id uuid)
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
  update public.partner_carts set invoiced_at = now(), invoiced_by = (select auth.uid())
    where id = p_cart_id and status = 'delivered' and invoiced_at is null;
  return found;
end
$$;

create function public.mark_partner_cart_invoiced(p_cart_id uuid)
returns boolean language sql security invoker set search_path = ''
as $$ select private.mark_partner_cart_invoiced(p_cart_id) $$;

revoke all on function private.mark_partner_cart_invoiced(uuid) from public, anon;
grant execute on function private.mark_partner_cart_invoiced(uuid) to authenticated;
revoke all on function public.mark_partner_cart_invoiced(uuid) from public, anon;
grant execute on function public.mark_partner_cart_invoiced(uuid) to authenticated;
