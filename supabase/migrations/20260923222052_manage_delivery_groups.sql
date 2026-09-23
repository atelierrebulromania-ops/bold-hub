-- The warehouse creates, edits and deletes delivery groups from the partners screen.
-- A partner can belong to several groups (it may fit more than one route).

-- Creates the group when p_group_id is null, otherwise renames it; either way the
-- members become exactly p_partner_ids. Returns the group id, or null when refused.
create function private.save_delivery_group(p_group_id uuid, p_name text, p_partner_ids uuid[]) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_id uuid := p_group_id;
begin
  if not private.is_staff(array['admin', 'operator_depozit']::public.user_role[]) then return null; end if;
  if length(v_name) not between 1 and 80 or coalesce(cardinality(p_partner_ids), 0) > 500 then return null; end if;
  if exists (select 1 from public.delivery_groups where lower(name) = lower(v_name) and id is distinct from p_group_id) then
    return null;
  end if;

  if v_id is null then
    insert into public.delivery_groups (name) values (v_name) returning id into v_id;
  else
    update public.delivery_groups set name = v_name where id = v_id;
    if not found then return null; end if;
  end if;

  delete from public.partner_delivery_groups
    where delivery_group_id = v_id and partner_id <> all(coalesce(p_partner_ids, '{}'));
  insert into public.partner_delivery_groups (partner_id, delivery_group_id)
    select p.id, v_id from public.partners p where p.id = any(coalesce(p_partner_ids, '{}'))
    on conflict do nothing;
  return v_id;
end
$$;
revoke all on function private.save_delivery_group(uuid, text, uuid[]) from public, anon;
grant execute on function private.save_delivery_group(uuid, text, uuid[]) to authenticated;

create function private.delete_delivery_group(p_group_id uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_staff(array['admin', 'operator_depozit']::public.user_role[]) then return false; end if;
  -- Old refill deliveries keep their history without the group.
  update public.deliveries set delivery_group_id = null where delivery_group_id = p_group_id;
  delete from public.delivery_groups where id = p_group_id;
  return found;
end
$$;
revoke all on function private.delete_delivery_group(uuid) from public, anon;
grant execute on function private.delete_delivery_group(uuid) to authenticated;

create function public.save_delivery_group(p_group_id uuid, p_name text, p_partner_ids uuid[]) returns uuid
language sql security invoker set search_path = ''
as $$ select private.save_delivery_group(p_group_id, p_name, p_partner_ids) $$;
revoke all on function public.save_delivery_group(uuid, text, uuid[]) from public, anon;
grant execute on function public.save_delivery_group(uuid, text, uuid[]) to authenticated;

create function public.delete_delivery_group(p_group_id uuid) returns boolean
language sql security invoker set search_path = ''
as $$ select private.delete_delivery_group(p_group_id) $$;
revoke all on function public.delete_delivery_group(uuid) from public, anon;
grant execute on function public.delete_delivery_group(uuid) to authenticated;
