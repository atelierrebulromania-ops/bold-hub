-- Admin deletes a staff profile. Their own inbox and personal collections go with it; an account
-- that appears in the history (orders prepared, documents, clients) is kept and should be deactivated.
create or replace function private.delete_staff_user(p_id uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $$
begin
  if (select auth.uid()) is null or coalesce((select private.current_role()) <> 'admin', true) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_id = (select auth.uid()) then return 'self'; end if;
  if not exists (select 1 from public.app_users where id = p_id) then return 'not_found'; end if;
  if exists (select 1 from public.partners where account_id = p_id) then return 'clients'; end if;

  begin
    delete from public.notifications where recipient_user_id = p_id;
    delete from public.product_collections where created_by = p_id;
    delete from public.app_users where id = p_id;
  exception when foreign_key_violation then
    return 'history';
  end;
  return 'deleted';
end
$$;

create or replace function public.delete_staff_user(p_id uuid) returns text language sql security invoker set search_path to ''
as $$ select private.delete_staff_user(p_id) $$;

revoke all on function private.delete_staff_user(uuid), public.delete_staff_user(uuid) from public, anon;
grant execute on function private.delete_staff_user(uuid), public.delete_staff_user(uuid) to authenticated;
