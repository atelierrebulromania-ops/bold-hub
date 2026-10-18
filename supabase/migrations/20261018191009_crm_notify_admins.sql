-- New leads also reach the admins (they can work leads too, and there may be no agent yet).
create or replace function private.notify_crm_agents(p_message text, p_lead_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into public.notifications (recipient_user_id, type, message, related_entity_type, related_entity_id)
    select u.id, 'lead_nou', left(p_message, 500), 'lead', p_lead_id
    from public.app_users u where u.active and (u.role = 'admin' or (u.role = 'account' and u.crm_access));
end
$$;
