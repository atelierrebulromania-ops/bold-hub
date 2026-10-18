-- Lead stages: Nou → De contactat (on claim) → Contactat → Ofertă trimisă → Câștigat / Pierdut.
-- An offer gets a reply deadline; when it passes, the agent is reminded to close the lead.

alter table public.leads drop constraint leads_status_check;
update public.leads set status = 'contacted' where status = 'qualified';
update public.leads set status = 'to_contact' where status = 'contacted' and claimed_by is not null
  and not exists (select 1 from public.lead_activities a where a.lead_id = leads.id and a.kind in ('status', 'note'));
alter table public.leads add constraint leads_status_check
  check (status in ('new', 'to_contact', 'contacted', 'offer', 'won', 'lost'));

alter table public.leads add column follow_up_at timestamptz, add column follow_up_notified_at timestamptz;
create index leads_follow_up_idx on public.leads (follow_up_at) where status = 'offer' and follow_up_notified_at is null;
update public.leads set follow_up_at = updated_at + interval '7 days' where status = 'offer';

alter table public.app_settings add column lead_offer_days integer not null default 7 check (lead_offer_days between 1 and 60);

create or replace function private.claim_lead(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not private.can_work_crm() then raise exception 'CRM access required' using errcode = '42501'; end if;
  update public.leads set claimed_by = (select auth.uid()), claimed_at = now(), updated_at = now(),
    status = case when status = 'new' then 'to_contact' else status end
  where id = p_id and claimed_by is null and status not in ('won', 'lost');
  if not found then return false; end if;
  insert into public.lead_activities (lead_id, user_id, kind, body) values (p_id, (select auth.uid()), 'claim', 'A preluat lead-ul.');
  return true;
end
$$;

-- Stage change by whoever holds the lead (or the admin). Ofertă trimisă starts the reply deadline.
drop function if exists public.set_lead_status(uuid, text, text);
drop function if exists private.set_lead_status(uuid, text, text);
create function private.set_lead_status(p_id uuid, p_status text, p_reason text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_labels jsonb := '{"new":"Nou","to_contact":"De contactat","contacted":"Contactat","offer":"Ofertă trimisă","won":"Câștigat","lost":"Pierdut"}';
  v_days integer := coalesce((select lead_offer_days from public.app_settings where id = 1), 7);
begin
  if not private.can_work_crm() then raise exception 'CRM access required' using errcode = '42501'; end if;
  if p_status not in ('to_contact', 'contacted', 'offer', 'lost') then raise exception 'Invalid status' using errcode = '22023'; end if;
  update public.leads set status = p_status, updated_at = now(),
    lost_reason = case when p_status = 'lost' then nullif(left(trim(p_reason), 300), '') else null end,
    follow_up_at = case when p_status = 'offer' then now() + make_interval(days => v_days) end,
    follow_up_notified_at = null
  where id = p_id and status <> 'won'
    and (claimed_by = (select auth.uid()) or (select private.current_role()) = 'admin');
  if not found then return false; end if;
  insert into public.lead_activities (lead_id, user_id, kind, body) values (p_id, (select auth.uid()), 'status',
    'Etapă: ' || (v_labels->>p_status)
    || case when p_status = 'offer' then ' — răspuns așteptat în ' || v_days || ' zile' else '' end
    || case when p_status = 'lost' and nullif(trim(p_reason), '') is not null then ' — ' || left(trim(p_reason), 300) else '' end);
  return true;
end
$$;

-- The client asked for time: move the reply deadline.
create or replace function private.postpone_lead_follow_up(p_id uuid, p_days integer)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not private.can_work_crm() then raise exception 'CRM access required' using errcode = '42501'; end if;
  if p_days is null or p_days not between 1 and 60 then raise exception 'Invalid days' using errcode = '22023'; end if;
  update public.leads set follow_up_at = greatest(now(), coalesce(follow_up_at, now())) + make_interval(days => p_days),
    follow_up_notified_at = null, updated_at = now()
  where id = p_id and status = 'offer'
    and (claimed_by = (select auth.uid()) or (select private.current_role()) = 'admin');
  if not found then return false; end if;
  insert into public.lead_activities (lead_id, user_id, kind, body)
    values (p_id, (select auth.uid()), 'status', 'Termen de răspuns amânat cu ' || p_days || ' zile.');
  return true;
end
$$;

-- Won clears the deadline too.
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
    follow_up_at = null, follow_up_notified_at = null,
    claimed_by = coalesce(claimed_by, (select auth.uid())), claimed_at = coalesce(claimed_at, now())
  where id = p_id and (claimed_by is null or claimed_by = (select auth.uid()) or (select private.current_role()) = 'admin');
  if not found then return false; end if;
  insert into public.lead_activities (lead_id, user_id, kind, body)
    select p_id, (select auth.uid()), 'client', 'Câștigat — client ' || p.business_name || '.' from public.partners p where p.id = p_partner_id;
  return true;
end
$$;

-- Scheduled: offers past their deadline remind the agent who holds them (once per deadline).
create or replace function private.remind_lead_offers()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare v_count integer;
begin
  with due as (
    update public.leads set follow_up_notified_at = now()
    where status = 'offer' and follow_up_at <= now() and follow_up_notified_at is null and claimed_by is not null
    returning id, claimed_by, coalesce(company, full_name, 'lead') as name
  )
  insert into public.notifications (recipient_user_id, type, message, related_entity_type, related_entity_id)
    select claimed_by, 'lead_oferta_scadenta', left('Oferta către ' || name || ' așteaptă răspuns: revino la client, apoi marchează câștigat sau pierdut.', 500), 'lead', id
    from due;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke all on function private.remind_lead_offers() from public, anon, authenticated;
select cron.schedule('lead-offer-reminders', '*/15 * * * *', $$select private.remind_lead_offers()$$);

-- Admin: how many days an offer waits for a reply.
create or replace function private.set_lead_offer_days(p_days integer)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if (select auth.uid()) is null or coalesce((select private.current_role()) <> 'admin', true) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_days is null or p_days not between 1 and 60 then raise exception 'Invalid days' using errcode = '22023'; end if;
  update public.app_settings set lead_offer_days = p_days where id = 1;
  return true;
end
$$;

create function public.set_lead_status(p_id uuid, p_status text, p_reason text) returns boolean language sql security invoker set search_path to ''
as $$ select private.set_lead_status(p_id, p_status, p_reason) $$;
create or replace function public.postpone_lead_follow_up(p_id uuid, p_days integer) returns boolean language sql security invoker set search_path to ''
as $$ select private.postpone_lead_follow_up(p_id, p_days) $$;
create or replace function public.set_lead_offer_days(p_days integer) returns boolean language sql security invoker set search_path to ''
as $$ select private.set_lead_offer_days(p_days) $$;

revoke all on function private.set_lead_status(uuid, text, text), private.postpone_lead_follow_up(uuid, integer), private.set_lead_offer_days(integer),
  public.set_lead_status(uuid, text, text), public.postpone_lead_follow_up(uuid, integer), public.set_lead_offer_days(integer) from public, anon, authenticated;
grant execute on function private.set_lead_status(uuid, text, text), private.postpone_lead_follow_up(uuid, integer), private.set_lead_offer_days(integer),
  public.set_lead_status(uuid, text, text), public.postpone_lead_follow_up(uuid, integer), public.set_lead_offer_days(integer) to authenticated;
