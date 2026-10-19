-- Alerts for leads left waiting: not claimed X hours after they arrive (to everyone who works the CRM),
-- and claimed but not contacted X hours after the claim (to the agent who claimed it). 0 hours = off.
-- Each lead alerts once per case; alerts go out only between 08:00 and 20:00 (Bucharest).
alter table public.app_settings
  add column lead_unclaimed_hours integer not null default 2 constraint app_settings_lead_unclaimed_hours_check check (lead_unclaimed_hours between 0 and 168),
  add column lead_uncontacted_hours integer not null default 24 constraint app_settings_lead_uncontacted_hours_check check (lead_uncontacted_hours between 0 and 168);
alter table public.leads add column unclaimed_alerted_at timestamptz, add column uncontacted_alerted_at timestamptz;

CREATE FUNCTION private.alert_stale_leads()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_settings record;
  v_names text;
  v_first uuid;
  v_unclaimed integer := 0;
  v_uncontacted integer := 0;
  v_hour integer := extract(hour from now() at time zone 'Europe/Bucharest');
begin
  if v_hour < 8 or v_hour >= 20 then return 0; end if;
  select lead_unclaimed_hours, lead_uncontacted_hours into v_settings from public.app_settings where id = 1;

  if v_settings.lead_unclaimed_hours > 0 then
    with due as (
      update public.leads set unclaimed_alerted_at = now()
      where status = 'new' and claimed_by is null and unclaimed_alerted_at is null
        and received_at <= now() - make_interval(hours => v_settings.lead_unclaimed_hours)
      returning id, received_at, coalesce(company, full_name, 'fără nume') as name
    )
    select count(*), string_agg(name, ', ' order by received_at), (array_agg(id order by received_at))[1]
      into v_unclaimed, v_names, v_first from due;
    if v_unclaimed > 0 then
      insert into public.notifications (recipient_user_id, type, message, related_entity_type, related_entity_id)
        select u.id, 'lead_nepreluat',
          left(case when v_unclaimed = 1 then 'Lead nepreluat de peste ' || v_settings.lead_unclaimed_hours || ' h: ' || v_names || '.'
            else v_unclaimed || ' lead-uri nepreluate de peste ' || v_settings.lead_unclaimed_hours || ' h: ' || v_names || '.' end, 500),
          'lead', case when v_unclaimed = 1 then v_first end
        from public.app_users u where u.active and (u.role = 'admin' or (u.role = 'account' and u.crm_access));
    end if;
  end if;

  if v_settings.lead_uncontacted_hours > 0 then
    with due as (
      update public.leads set uncontacted_alerted_at = now()
      where status = 'to_contact' and claimed_by is not null and uncontacted_alerted_at is null
        and claimed_at <= now() - make_interval(hours => v_settings.lead_uncontacted_hours)
      returning id, claimed_by, coalesce(company, full_name, 'lead') as name
    )
    insert into public.notifications (recipient_user_id, type, message, related_entity_type, related_entity_id)
      select claimed_by, 'lead_necontactat',
        left('Ai preluat ' || name || ' acum peste ' || v_settings.lead_uncontacted_hours || ' h și nu e marcat contactat. Sună clientul, apoi actualizează etapa.', 500),
        'lead', id
      from due;
    get diagnostics v_uncontacted = row_count;
  end if;
  return v_unclaimed + v_uncontacted;
end
$function$;
revoke all on function private.alert_stale_leads() from public, anon, authenticated;

CREATE FUNCTION private.set_lead_alert_hours(p_unclaimed integer, p_uncontacted integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (select auth.uid()) is null or coalesce((select private.current_role()) <> 'admin', true) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_unclaimed is null or p_unclaimed not between 0 and 168 or p_uncontacted is null or p_uncontacted not between 0 and 168 then
    raise exception 'Invalid hours' using errcode = '22023';
  end if;
  update public.app_settings set lead_unclaimed_hours = p_unclaimed, lead_uncontacted_hours = p_uncontacted where id = 1;
  return true;
end
$function$;
revoke all on function private.set_lead_alert_hours(integer, integer) from public, anon;
grant execute on function private.set_lead_alert_hours(integer, integer) to authenticated;

CREATE FUNCTION public.set_lead_alert_hours(p_unclaimed integer, p_uncontacted integer)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select private.set_lead_alert_hours(p_unclaimed, p_uncontacted) $function$;
revoke all on function public.set_lead_alert_hours(integer, integer) from public, anon;
grant execute on function public.set_lead_alert_hours(integer, integer) to authenticated;

-- Runs with the offer reminders, every 15 minutes.
select cron.schedule('lead-offer-reminders', '*/15 * * * *', 'select private.remind_lead_offers(), private.alert_stale_leads()');
