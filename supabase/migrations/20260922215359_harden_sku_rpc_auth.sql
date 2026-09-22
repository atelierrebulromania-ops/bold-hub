-- Null-safe authorization gate for both exposed RPCs. The original helpers
-- become callable only by their database-owner wrappers, never directly by users.
create function private.scan_online_order_code_guarded(p_order_id uuid, p_code text) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or (
    (select private.current_role()) is distinct from 'admin'::public.user_role
    and (select private.current_role()) is distinct from 'operator_depozit'::public.user_role
  ) then
    return false;
  end if;
  return private.scan_online_order_code(p_order_id, p_code);
end
$$;
revoke all on function private.scan_online_order_code(uuid, text) from authenticated;
revoke all on function private.scan_online_order_code_guarded(uuid, text) from public, anon;
grant execute on function private.scan_online_order_code_guarded(uuid, text) to authenticated;

create or replace function public.scan_online_order_code(p_order_id uuid, p_code text) returns boolean
language sql security invoker set search_path = ''
as $$ select private.scan_online_order_code_guarded(p_order_id, p_code) $$;

create function private.import_bocp_online_orders_guarded(p_orders jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or (select private.current_role()) is distinct from 'admin'::public.user_role then
    raise exception 'Administrator access required';
  end if;
  return private.import_bocp_online_orders(p_orders);
end
$$;
revoke all on function private.import_bocp_online_orders(jsonb) from authenticated;
revoke all on function private.import_bocp_online_orders_guarded(jsonb) from public, anon;
grant execute on function private.import_bocp_online_orders_guarded(jsonb) to authenticated;

create or replace function public.import_bocp_online_orders(p_orders jsonb) returns jsonb
language sql security invoker set search_path = ''
as $$ select private.import_bocp_online_orders_guarded(p_orders) $$;
