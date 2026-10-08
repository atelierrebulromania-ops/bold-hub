-- Browser push for staff: each device a user enables is a subscription. Notifications addressed to
-- a user or a role are pushed once (push_sent_at), by the server's dispatch job.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) <= 200),
  auth text not null check (length(auth) <= 100),
  user_agent text check (length(user_agent) <= 400),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy own_subscriptions on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

alter table public.notifications add column push_sent_at timestamptz;
update public.notifications set push_sent_at = now();
create index notifications_push_pending_idx on public.notifications (created_at) where push_sent_at is null;

-- A staff member enables push on this device (the same browser moves to whoever signs in on it).
create or replace function private.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not private.is_staff(array['admin', 'owner', 'operator_depozit', 'operator_facturare', 'account']::public.user_role[]) then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
    values ((select auth.uid()), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 400))
    on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
      user_agent = excluded.user_agent, created_at = now();
  return true;
end
$$;

create or replace function private.delete_push_subscription(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = (select auth.uid());
  return found;
end
$$;

-- Dispatch (service role): takes the staff notifications not pushed yet (last hour only) and marks them.
create or replace function private.claim_push_notifications(p_limit integer)
returns table (id uuid, message text, related_entity_type text, recipient_user_id uuid, recipient_role public.user_role)
language plpgsql
security definer
set search_path to ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service access required' using errcode = '42501';
  end if;
  return query
    update public.notifications n set push_sent_at = now()
    where n.id in (
      select x.id from public.notifications x
      where x.push_sent_at is null and x.recipient_partner_id is null and x.read_at is null
        and x.created_at > now() - interval '1 hour'
      order by x.created_at
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
      for update skip locked)
    returning n.id, n.message, n.related_entity_type, n.recipient_user_id, n.recipient_role;
end
$$;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text) returns boolean
language sql security invoker set search_path to '' as $$ select private.save_push_subscription(p_endpoint, p_p256dh, p_auth, p_user_agent) $$;
create or replace function public.delete_push_subscription(p_endpoint text) returns boolean
language sql security invoker set search_path to '' as $$ select private.delete_push_subscription(p_endpoint) $$;
create or replace function public.claim_push_notifications(p_limit integer)
returns table (id uuid, message text, related_entity_type text, recipient_user_id uuid, recipient_role public.user_role)
language sql security invoker set search_path to '' as $$ select * from private.claim_push_notifications(p_limit) $$;

revoke all on function private.save_push_subscription(text, text, text, text), private.delete_push_subscription(text),
  private.claim_push_notifications(integer), public.save_push_subscription(text, text, text, text),
  public.delete_push_subscription(text), public.claim_push_notifications(integer) from public, anon, authenticated;
grant execute on function private.save_push_subscription(text, text, text, text), private.delete_push_subscription(text),
  public.save_push_subscription(text, text, text, text), public.delete_push_subscription(text) to authenticated;
grant execute on function private.claim_push_notifications(integer), public.claim_push_notifications(integer) to service_role;
