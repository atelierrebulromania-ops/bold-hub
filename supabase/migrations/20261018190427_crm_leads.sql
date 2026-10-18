-- CRM: leads from ads and forms. Users the admin picks see every lead; sales agents among them
-- take a lead (like warehouse orders) and work it through the stages; a won lead becomes a client.

alter table public.app_users add column crm_access boolean not null default false;

-- Admin always; others when the admin gave them access.
create or replace function private.can_view_crm()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce((select u.active and (u.role = 'admin' or u.crm_access) from public.app_users u where u.id = (select auth.uid())), false)
$$;

-- Only agents (and the admin, who can play one) take and work leads.
create or replace function private.can_work_crm()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce((select u.active and (u.role = 'admin' or (u.role = 'account' and u.crm_access)) from public.app_users u where u.id = (select auth.uid())), false)
$$;

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('meta', 'website', 'google', 'tiktok', 'manual', 'import')),
  external_id text check (length(external_id) <= 200),
  campaign text check (length(campaign) <= 300),
  ad_name text check (length(ad_name) <= 300),
  form_name text check (length(form_name) <= 300),
  full_name text check (length(full_name) <= 200),
  company text check (length(company) <= 200),
  phone text check (length(phone) <= 60),
  email text check (length(email) <= 254),
  city text check (length(city) <= 120),
  message text check (length(message) <= 4000),
  answers jsonb not null default '{}'::jsonb,
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'offer', 'won', 'lost')),
  lost_reason text check (length(lost_reason) <= 300),
  claimed_by uuid references public.app_users(id) on delete set null,
  claimed_at timestamptz,
  partner_id uuid references public.partners(id) on delete set null,
  created_by uuid references public.app_users(id) on delete set null,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);
create index leads_status_idx on public.leads (status, received_at desc);
create index leads_claimed_idx on public.leads (claimed_by);

create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid references public.app_users(id) on delete set null,
  kind text not null check (kind in ('received', 'claim', 'release', 'status', 'note', 'client')),
  body text check (length(body) <= 4000),
  created_at timestamptz not null default now()
);
create index lead_activities_lead_idx on public.lead_activities (lead_id, created_at);

alter table public.leads enable row level security;
alter table public.lead_activities enable row level security;
create policy crm_read on public.leads for select to authenticated using ((select private.can_view_crm()));
create policy crm_read on public.lead_activities for select to authenticated using ((select private.can_view_crm()));
alter publication supabase_realtime add table public.leads;

-- Where leads arrive from outside: the admin shares this URL key with Make/Zapier/MailerLite.
alter table public.app_settings add column leads_webhook_key text;
update public.app_settings set leads_webhook_key = encode(extensions.gen_random_bytes(24), 'hex') where id = 1;

-- Everyone who works leads hears about a new one (push included).
create or replace function private.notify_crm_agents(p_message text, p_lead_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into public.notifications (recipient_user_id, type, message, related_entity_type, related_entity_id)
    select u.id, 'lead_nou', left(p_message, 500), 'lead', p_lead_id
    from public.app_users u where u.active and u.role = 'account' and u.crm_access;
end
$$;

-- Incoming lead (service role: the webhook). The same source + external id is stored once.
create or replace function private.ingest_lead(p_lead jsonb)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_id uuid;
  v_source text := coalesce(nullif(trim(p_lead->>'source'), ''), 'website');
  v_external text := nullif(left(trim(p_lead->>'external_id'), 200), '');
  v_name text := nullif(left(trim(p_lead->>'full_name'), 200), '');
  v_company text := nullif(left(trim(p_lead->>'company'), 200), '');
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service access required' using errcode = '42501';
  end if;
  if v_source not in ('meta', 'website', 'google', 'tiktok', 'import') then
    raise exception 'Unknown lead source' using errcode = '22023';
  end if;
  if v_external is not null then
    select id into v_id from public.leads where source = v_source and external_id = v_external;
    if found then return v_id; end if;
  end if;

  insert into public.leads (source, external_id, campaign, ad_name, form_name, full_name, company, phone, email, city, message, answers, received_at)
  values (v_source, v_external,
    nullif(left(trim(p_lead->>'campaign'), 300), ''), nullif(left(trim(p_lead->>'ad_name'), 300), ''),
    nullif(left(trim(p_lead->>'form_name'), 300), ''), v_name, v_company,
    nullif(left(trim(p_lead->>'phone'), 60), ''), nullif(left(lower(trim(p_lead->>'email')), 254), ''),
    nullif(left(trim(p_lead->>'city'), 120), ''), nullif(left(trim(p_lead->>'message'), 4000), ''),
    case when jsonb_typeof(p_lead->'answers') = 'object' then p_lead->'answers' else '{}'::jsonb end,
    coalesce((p_lead->>'received_at')::timestamptz, now()))
  returning id into v_id;
  insert into public.lead_activities (lead_id, kind, body) values (v_id, 'received', 'Lead primit din ' || v_source || '.');
  perform private.notify_crm_agents('Lead nou: ' || coalesce(v_company, v_name, 'fără nume')
    || case when p_lead->>'campaign' is not null then ' (' || left(p_lead->>'campaign', 80) || ')' else '' end, v_id);
  return v_id;
end
$$;

-- A lead added by hand (an agent or the admin), or one from a CSV import.
create or replace function private.create_lead(p_lead jsonb)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_id uuid;
  v_source text := case when p_lead->>'source' = 'import' then 'import' else 'manual' end;
  v_name text := nullif(left(trim(p_lead->>'full_name'), 200), '');
  v_company text := nullif(left(trim(p_lead->>'company'), 200), '');
  v_external text := nullif(left(trim(p_lead->>'external_id'), 200), '');
begin
  if not private.can_work_crm() then raise exception 'CRM access required' using errcode = '42501'; end if;
  if v_name is null and v_company is null then raise exception 'Name or company required' using errcode = '22023'; end if;
  if v_external is not null then
    select id into v_id from public.leads where external_id = v_external and source in ('meta', 'import');
    if found then return null; end if;
  end if;
  insert into public.leads (source, external_id, campaign, form_name, full_name, company, phone, email, city, message, answers, created_by, received_at)
  values (v_source, v_external, nullif(left(trim(p_lead->>'campaign'), 300), ''), nullif(left(trim(p_lead->>'form_name'), 300), ''),
    v_name, v_company, nullif(left(trim(p_lead->>'phone'), 60), ''), nullif(left(lower(trim(p_lead->>'email')), 254), ''),
    nullif(left(trim(p_lead->>'city'), 120), ''), nullif(left(trim(p_lead->>'message'), 4000), ''),
    case when jsonb_typeof(p_lead->'answers') = 'object' then p_lead->'answers' else '{}'::jsonb end,
    (select auth.uid()), coalesce((p_lead->>'received_at')::timestamptz, now()))
  returning id into v_id;
  insert into public.lead_activities (lead_id, user_id, kind, body)
    values (v_id, (select auth.uid()), 'received', case when v_source = 'import' then 'Lead importat.' else 'Lead adăugat manual.' end);
  return v_id;
end
$$;

-- An agent takes a free lead (first one wins, like warehouse orders).
create or replace function private.claim_lead(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not private.can_work_crm() then raise exception 'CRM access required' using errcode = '42501'; end if;
  update public.leads set claimed_by = (select auth.uid()), claimed_at = now(), updated_at = now(),
    status = case when status = 'new' then 'contacted' else status end
  where id = p_id and claimed_by is null and status not in ('won', 'lost');
  if not found then return false; end if;
  insert into public.lead_activities (lead_id, user_id, kind, body) values (p_id, (select auth.uid()), 'claim', 'A preluat lead-ul.');
  return true;
end
$$;

-- The agent (or the admin) gives a lead back to the pool.
create or replace function private.release_lead(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not private.can_work_crm() then raise exception 'CRM access required' using errcode = '42501'; end if;
  update public.leads set claimed_by = null, claimed_at = null, updated_at = now()
  where id = p_id and status not in ('won', 'lost')
    and (claimed_by = (select auth.uid()) or (select private.current_role()) = 'admin');
  if not found then return false; end if;
  insert into public.lead_activities (lead_id, user_id, kind, body) values (p_id, (select auth.uid()), 'release', 'A eliberat lead-ul.');
  return true;
end
$$;

-- Stage change by whoever holds the lead (or the admin). Won needs a client (see link_lead_client).
create or replace function private.set_lead_status(p_id uuid, p_status text, p_reason text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_labels jsonb := '{"new":"Nou","contacted":"Contactat","qualified":"Calificat","offer":"Ofertă trimisă","won":"Câștigat","lost":"Pierdut"}';
begin
  if not private.can_work_crm() then raise exception 'CRM access required' using errcode = '42501'; end if;
  if p_status not in ('contacted', 'qualified', 'offer', 'lost', 'new') then raise exception 'Invalid status' using errcode = '22023'; end if;
  update public.leads set status = p_status, updated_at = now(),
    lost_reason = case when p_status = 'lost' then nullif(left(trim(p_reason), 300), '') else null end
  where id = p_id and status <> 'won'
    and (claimed_by = (select auth.uid()) or (select private.current_role()) = 'admin');
  if not found then return false; end if;
  insert into public.lead_activities (lead_id, user_id, kind, body) values (p_id, (select auth.uid()), 'status',
    'Etapă: ' || (v_labels->>p_status) || case when p_status = 'lost' and nullif(trim(p_reason), '') is not null then ' — ' || left(trim(p_reason), 300) else '' end);
  return true;
end
$$;

create or replace function private.add_lead_note(p_id uuid, p_body text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not private.can_work_crm() then raise exception 'CRM access required' using errcode = '42501'; end if;
  if nullif(trim(p_body), '') is null or length(p_body) > 4000 then raise exception 'Invalid note' using errcode = '22023'; end if;
  if not exists (select 1 from public.leads where id = p_id) then return false; end if;
  insert into public.lead_activities (lead_id, user_id, kind, body) values (p_id, (select auth.uid()), 'note', trim(p_body));
  update public.leads set updated_at = now() where id = p_id;
  return true;
end
$$;

-- Won: the lead became (or matches) a client of the agent.
create or replace function private.link_lead_client(p_id uuid, p_partner_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not private.can_work_crm() then raise exception 'CRM access required' using errcode = '42501'; end if;
  if not private.can_manage_partner(p_partner_id) then raise exception 'Client access required' using errcode = '42501'; end if;
  update public.leads set partner_id = p_partner_id, status = 'won', lost_reason = null, updated_at = now(),
    claimed_by = coalesce(claimed_by, (select auth.uid())), claimed_at = coalesce(claimed_at, now())
  where id = p_id and (claimed_by is null or claimed_by = (select auth.uid()) or (select private.current_role()) = 'admin');
  if not found then return false; end if;
  insert into public.lead_activities (lead_id, user_id, kind, body)
    select p_id, (select auth.uid()), 'client', 'Câștigat — client ' || p.business_name || '.' from public.partners p where p.id = p_partner_id;
  return true;
end
$$;

-- Admin: who has CRM access, and the webhook key.
create or replace function private.set_crm_access(p_user_id uuid, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if (select auth.uid()) is null or coalesce((select private.current_role()) <> 'admin', true) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  update public.app_users set crm_access = coalesce(p_on, false) where id = p_user_id;
  return found;
end
$$;

create or replace function private.rotate_leads_webhook_key()
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare v_key text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if (select auth.uid()) is null or coalesce((select private.current_role()) <> 'admin', true) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  update public.app_settings set leads_webhook_key = v_key where id = 1;
  return v_key;
end
$$;

-- Names of who holds leads, for everyone who sees the CRM.
create or replace function private.crm_people()
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path to ''
as $$
  select u.id, u.full_name from public.app_users u where private.can_view_crm() and (u.role in ('admin', 'account'))
$$;

-- Invoker wrappers.
create or replace function public.can_view_crm() returns boolean language sql stable security invoker set search_path to '' as $$ select private.can_view_crm() $$;
create or replace function public.ingest_lead(p_lead jsonb) returns uuid language sql security invoker set search_path to '' as $$ select private.ingest_lead(p_lead) $$;
create or replace function public.create_lead(p_lead jsonb) returns uuid language sql security invoker set search_path to '' as $$ select private.create_lead(p_lead) $$;
create or replace function public.claim_lead(p_id uuid) returns boolean language sql security invoker set search_path to '' as $$ select private.claim_lead(p_id) $$;
create or replace function public.release_lead(p_id uuid) returns boolean language sql security invoker set search_path to '' as $$ select private.release_lead(p_id) $$;
create or replace function public.set_lead_status(p_id uuid, p_status text, p_reason text) returns boolean language sql security invoker set search_path to '' as $$ select private.set_lead_status(p_id, p_status, p_reason) $$;
create or replace function public.add_lead_note(p_id uuid, p_body text) returns boolean language sql security invoker set search_path to '' as $$ select private.add_lead_note(p_id, p_body) $$;
create or replace function public.link_lead_client(p_id uuid, p_partner_id uuid) returns boolean language sql security invoker set search_path to '' as $$ select private.link_lead_client(p_id, p_partner_id) $$;
create or replace function public.set_crm_access(p_user_id uuid, p_on boolean) returns boolean language sql security invoker set search_path to '' as $$ select private.set_crm_access(p_user_id, p_on) $$;
create or replace function public.rotate_leads_webhook_key() returns text language sql security invoker set search_path to '' as $$ select private.rotate_leads_webhook_key() $$;
create or replace function public.crm_people() returns table (id uuid, full_name text) language sql stable security invoker set search_path to '' as $$ select * from private.crm_people() $$;

revoke all on function private.can_view_crm(), private.can_work_crm(), private.notify_crm_agents(text, uuid), private.ingest_lead(jsonb),
  private.create_lead(jsonb), private.claim_lead(uuid), private.release_lead(uuid), private.set_lead_status(uuid, text, text),
  private.add_lead_note(uuid, text), private.link_lead_client(uuid, uuid), private.set_crm_access(uuid, boolean),
  private.rotate_leads_webhook_key(), private.crm_people(),
  public.can_view_crm(), public.ingest_lead(jsonb), public.create_lead(jsonb), public.claim_lead(uuid), public.release_lead(uuid),
  public.set_lead_status(uuid, text, text), public.add_lead_note(uuid, text), public.link_lead_client(uuid, uuid),
  public.set_crm_access(uuid, boolean), public.rotate_leads_webhook_key(), public.crm_people() from public, anon, authenticated;
grant execute on function private.can_view_crm(), private.can_work_crm(), private.create_lead(jsonb), private.claim_lead(uuid),
  private.release_lead(uuid), private.set_lead_status(uuid, text, text), private.add_lead_note(uuid, text),
  private.link_lead_client(uuid, uuid), private.set_crm_access(uuid, boolean), private.rotate_leads_webhook_key(), private.crm_people(),
  public.can_view_crm(), public.create_lead(jsonb), public.claim_lead(uuid), public.release_lead(uuid),
  public.set_lead_status(uuid, text, text), public.add_lead_note(uuid, text), public.link_lead_client(uuid, uuid),
  public.set_crm_access(uuid, boolean), public.rotate_leads_webhook_key(), public.crm_people() to authenticated;
grant execute on function private.ingest_lead(jsonb), private.notify_crm_agents(text, uuid), public.ingest_lead(jsonb) to service_role;
