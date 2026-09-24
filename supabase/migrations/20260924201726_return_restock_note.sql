-- The warehouse can confirm a return "with remarks" (a note on what it found in the parcel).
-- Billing is told about those, since the note usually changes what goes back into BOCP stock.
alter table public.order_returns add column restock_note text
  check (restock_note is null or char_length(restock_note) between 1 and 1000);

drop function public.confirm_return_restock(uuid);
drop function private.confirm_return_restock(uuid);

create function private.confirm_return_restock(p_return_id uuid, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_note text := nullif(btrim(p_note), '');
  v_invoice text;
begin
  if (select auth.uid()) is null
    or not coalesce((select private.current_role()) in ('admin', 'operator_depozit'), false) then
    return false;
  end if;
  if char_length(v_note) > 1000 then raise exception 'Note too long' using errcode = '22023'; end if;
  update public.order_returns
    set status = 'restocked', restocked_by = (select auth.uid()), restocked_at = now(), restock_note = v_note
    where id = p_return_id and status = 'pending_restock';
  if not found then return false; end if;
  if v_note is not null then
    select o.invoice_number into v_invoice
      from public.order_returns r join public.online_orders o on o.id = r.online_order_id where r.id = p_return_id;
    perform private.notify('operator_facturare', 'retur_cu_mentiuni',
      'Retur procesat cu mențiuni: factura ' || v_invoice || ' — ' || v_note, 'order_return', p_return_id);
  end if;
  return true;
end
$$;

create function public.confirm_return_restock(p_return_id uuid, p_note text default null)
returns boolean language sql security invoker set search_path = ''
as $$ select private.confirm_return_restock(p_return_id, p_note) $$;

revoke all on function private.confirm_return_restock(uuid, text) from public, anon;
grant execute on function private.confirm_return_restock(uuid, text) to authenticated;
revoke all on function public.confirm_return_restock(uuid, text) from public, anon;
grant execute on function public.confirm_return_restock(uuid, text) to authenticated;
