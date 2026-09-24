-- A plain confirmation may carry a note too; only "Procesat cu mențiuni" flags the return
-- and notifies billing.
alter table public.order_returns add column restocked_with_remarks boolean not null default false;
update public.order_returns set restocked_with_remarks = true where restock_note is not null;

drop function public.confirm_return_restock(uuid, text);
drop function private.confirm_return_restock(uuid, text);

create function private.confirm_return_restock(p_return_id uuid, p_note text default null, p_with_remarks boolean default false)
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
  if p_with_remarks and v_note is null then return false; end if;
  update public.order_returns
    set status = 'restocked', restocked_by = (select auth.uid()), restocked_at = now(),
      restock_note = v_note, restocked_with_remarks = p_with_remarks
    where id = p_return_id and status = 'pending_restock';
  if not found then return false; end if;
  if p_with_remarks then
    select o.invoice_number into v_invoice
      from public.order_returns r join public.online_orders o on o.id = r.online_order_id where r.id = p_return_id;
    perform private.notify('operator_facturare', 'retur_cu_mentiuni',
      'Retur procesat cu mențiuni: factura ' || v_invoice || ' — ' || v_note, 'order_return', p_return_id);
  end if;
  return true;
end
$$;

create function public.confirm_return_restock(p_return_id uuid, p_note text default null, p_with_remarks boolean default false)
returns boolean language sql security invoker set search_path = ''
as $$ select private.confirm_return_restock(p_return_id, p_note, p_with_remarks) $$;

revoke all on function private.confirm_return_restock(uuid, text, boolean) from public, anon;
grant execute on function private.confirm_return_restock(uuid, text, boolean) to authenticated;
revoke all on function public.confirm_return_restock(uuid, text, boolean) from public, anon;
grant execute on function public.confirm_return_restock(uuid, text, boolean) to authenticated;
