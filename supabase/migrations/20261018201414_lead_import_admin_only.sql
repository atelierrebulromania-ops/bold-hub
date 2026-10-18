-- Only the admin imports leads from a file; agents add them one by one.
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
  if v_source = 'import' and coalesce((select private.current_role()) <> 'admin', true) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
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
