-- The order board shows who claimed each order. app_users stays readable only
-- for one's own row; warehouse staff get names (no phone or role) through an RPC.

create function private.staff_names() returns table (id uuid, full_name text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or coalesce((select private.current_role()) not in ('admin', 'operator_depozit'), true) then
    raise exception 'Staff access required';
  end if;
  return query
    select u.id, u.full_name from public.app_users u
    where u.role in ('admin', 'operator_depozit');
end
$$;
revoke all on function private.staff_names() from public, anon;
grant execute on function private.staff_names() to authenticated;

create function public.staff_names() returns table (id uuid, full_name text)
language sql stable security invoker set search_path = ''
as $$ select * from private.staff_names() $$;
revoke all on function public.staff_names() from public, anon;
grant execute on function public.staff_names() to authenticated;
