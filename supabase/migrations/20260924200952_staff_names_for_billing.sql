-- Billing now uses "Predate curierului" (with the order search), so it needs the operator names too.
create or replace function private.staff_names()
returns table(id uuid, full_name text)
language plpgsql
stable security definer
set search_path to ''
as $$
begin
  if (select auth.uid()) is null
    or coalesce((select private.current_role()) not in ('admin', 'operator_depozit', 'operator_facturare'), true) then
    raise exception 'Staff access required';
  end if;
  return query
    select u.id, u.full_name from public.app_users u
    where u.role in ('admin', 'operator_depozit');
end
$$;
