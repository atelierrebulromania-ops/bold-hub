-- "De contactat" stays as before; "Calificare" (status contacted) is the step after it, where the agent decides
-- Calificat (qualified, then the offer) or Necalificat (unqualified, closed with a reason).
alter table public.leads drop constraint leads_status_check;
alter table public.leads add constraint leads_status_check
  check (status = any (array['new', 'to_contact', 'contacted', 'qualified', 'unqualified', 'offer', 'won', 'lost']));

-- The leads moved from Contactat to Calificat by the previous migration go back to Calificare, unless an agent has
-- qualified them since.
update public.leads l set status = 'contacted', updated_at = now()
  where l.status = 'qualified'
    and not exists (select 1 from public.lead_activities a where a.lead_id = l.id and a.kind = 'status'
      and a.body like 'Etapă: Calificat%' and a.created_at >= '2026-11-22 22:45:00+00');

create or replace function private.set_lead_status(p_id uuid, p_status text, p_reason text)
returns boolean language plpgsql security definer set search_path to '' as $$
declare
  v_labels jsonb := '{"new":"Nou","to_contact":"De contactat","contacted":"Calificare","qualified":"Calificat","unqualified":"Necalificat","offer":"Ofertă trimisă","won":"Câștigat","lost":"Pierdut"}';
  v_days integer := coalesce((select lead_offer_days from public.app_settings where id = 1), 7);
  v_closing boolean := p_status in ('lost', 'unqualified');
begin
  if not private.can_work_crm() then raise exception 'CRM access required' using errcode = '42501'; end if;
  if p_status not in ('to_contact', 'contacted', 'qualified', 'unqualified', 'offer', 'lost') then raise exception 'Invalid status' using errcode = '22023'; end if;
  -- lost_reason holds the reason of either closing stage.
  update public.leads set status = p_status, updated_at = now(),
    lost_reason = case when v_closing then nullif(left(trim(p_reason), 300), '') else null end,
    follow_up_at = case when p_status = 'offer' then now() + make_interval(days => v_days) end,
    follow_up_notified_at = null
  where id = p_id and status <> 'won'
    and (claimed_by = (select auth.uid()) or (select private.current_role()) = 'admin');
  if not found then return false; end if;
  insert into public.lead_activities (lead_id, user_id, kind, body) values (p_id, (select auth.uid()), 'status',
    'Etapă: ' || (v_labels->>p_status)
    || case when p_status = 'offer' then ' — răspuns așteptat în ' || v_days || ' zile' else '' end
    || case when v_closing and nullif(trim(p_reason), '') is not null then ' — ' || left(trim(p_reason), 300) else '' end);
  return true;
end
$$;

-- The alert is again about a lead not contacted yet.
do $$
declare v_def text := pg_get_functiondef('private.alert_stale_leads()'::regprocedure);
begin
  if position($q$și nu e calificat încă. Sună clientul, apoi marchează-l calificat sau necalificat.$q$ in v_def) = 0 then
    raise exception 'Unexpected definition of alert_stale_leads';
  end if;
  execute replace(v_def, $q$și nu e calificat încă. Sună clientul, apoi marchează-l calificat sau necalificat.$q$,
    $q$și nu e marcat contactat. Sună clientul, apoi treci-l la Calificare.$q$);
end $$;
