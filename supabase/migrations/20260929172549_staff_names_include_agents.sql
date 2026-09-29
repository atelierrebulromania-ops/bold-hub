-- Billing shows which agent sent a proforma, and agents see who made a collection: names of the
-- sales agents are listed too, and agents may read the list.
create or replace function private.staff_names()
returns table(id uuid, full_name text)
language plpgsql
stable security definer
set search_path to ''
as $$
begin
  if (select auth.uid()) is null
    or coalesce((select private.current_role()) not in ('admin', 'operator_depozit', 'operator_facturare', 'account'), true) then
    raise exception 'Staff access required';
  end if;
  return query
    select u.id, u.full_name from public.app_users u
    where u.role in ('admin', 'operator_depozit', 'operator_facturare', 'account');
end
$$;
