-- Consignment contracts and custody items.
-- Contracts: the agent uploads the PDF signed by us ("semnat de furnizor"); the client downloads it, signs it
-- and uploads it back ("semnat de ambele părți"). Files live in the private bucket "partner-contracts" and are
-- only reached through the app (signed URLs made on the server).
-- Custody: what stays ours at the client: testers, POS materials (shelf, glass, bells) and diffusers on trial.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('partner-contracts', 'partner-contracts', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

create table public.partner_contracts (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  title text not null constraint partner_contracts_title_check check (char_length(title) between 1 and 200),
  status text not null default 'supplier_signed' constraint partner_contracts_status_check check (status in ('supplier_signed', 'both_signed')),
  supplier_file text not null,
  supplier_uploaded_at timestamptz not null default now(),
  supplier_uploaded_by uuid references auth.users(id) on delete set null,
  signed_file text,
  signed_uploaded_at timestamptz,
  signed_uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index partner_contracts_partner_idx on public.partner_contracts (partner_id, created_at desc);
alter table public.partner_contracts enable row level security;
create policy staff_read on public.partner_contracts for select to authenticated
  using ((select private.current_role()) = any (array['admin'::public.user_role, 'owner'::public.user_role]));
create policy account_own on public.partner_contracts for select to authenticated
  using ((select private.current_role()) = 'account'::public.user_role
    and exists (select 1 from public.partners p where p.id = partner_contracts.partner_id and p.account_id = (select auth.uid())));
-- Contracts are per company (CUI): the manager login sees them, a point login does not.
create policy partner_own on public.partner_contracts for select to authenticated
  using (partner_id = (select private.my_partner_id()) and (select private.my_point_id()) is null);

create table public.partner_custody_items (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  location_id uuid references public.partner_locations(id) on delete set null,
  kind text not null constraint partner_custody_kind_check check (kind in ('tester', 'pos', 'trial')),
  product_id uuid references public.products(id) on delete set null,
  name text not null constraint partner_custody_name_check check (char_length(name) between 1 and 200),
  quantity integer not null constraint partner_custody_quantity_check check (quantity between 1 and 10000),
  unit_value numeric(12,2) constraint partner_custody_value_check check (unit_value is null or unit_value >= 0),
  handed_on date not null default current_date,
  trial_ends_on date,
  status text not null default 'at_client' constraint partner_custody_status_check check (status in ('at_client', 'returned', 'missing', 'converted')),
  closed_on date,
  note text constraint partner_custody_note_check check (note is null or char_length(note) <= 500),
  trial_notified_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index partner_custody_partner_idx on public.partner_custody_items (partner_id, status);
alter table public.partner_custody_items enable row level security;
create policy staff_read on public.partner_custody_items for select to authenticated
  using ((select private.current_role()) = any (array['admin'::public.user_role, 'owner'::public.user_role, 'operator_depozit'::public.user_role, 'operator_facturare'::public.user_role]));
create policy account_own on public.partner_custody_items for select to authenticated
  using ((select private.current_role()) = 'account'::public.user_role
    and exists (select 1 from public.partners p where p.id = partner_custody_items.partner_id and p.account_id = (select auth.uid())));
create policy partner_own on public.partner_custody_items for select to authenticated
  using (partner_id = (select private.my_partner_id()) and ((select private.my_point_id()) is null or location_id = (select private.my_point_id())));

-- The agent (or admin) records a contract whose PDF was just uploaded; the client is told to sign it.
CREATE FUNCTION private.record_partner_contract(p_id uuid, p_partner_id uuid, p_title text, p_file text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.can_manage_partner(p_partner_id) then return false; end if;
  if p_file is null or p_file not like p_partner_id::text || '/' || p_id::text || '/%' then raise exception 'Invalid file' using errcode = '22023'; end if;
  insert into public.partner_contracts (id, partner_id, title, supplier_file, supplier_uploaded_by)
    values (p_id, p_partner_id, left(btrim(p_title), 200), p_file, (select auth.uid()));
  insert into public.notifications (recipient_partner_id, type, message, related_entity_type, related_entity_id)
    values (p_partner_id, 'contract_nou', left('Contract nou de semnat: ' || btrim(p_title) || '. Descarcă-l din aplicație, semnează-l și încarcă-l înapoi.', 500), 'contract', p_id);
  return true;
end
$function$;

-- The client's manager (or the agent, on its behalf) uploads the contract signed by both parties.
CREATE FUNCTION private.record_signed_contract(p_id uuid, p_file text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_contract record; v_by_partner boolean;
begin
  select c.id, c.partner_id, c.title, p.account_id, p.business_name into v_contract
    from public.partner_contracts c join public.partners p on p.id = c.partner_id where c.id = p_id for update of c;
  if not found then return false; end if;
  v_by_partner := v_contract.partner_id = private.my_partner_id() and private.my_point_id() is null;
  if not (v_by_partner or private.can_manage_partner(v_contract.partner_id)) then return false; end if;
  if p_file is null or p_file not like v_contract.partner_id::text || '/' || p_id::text || '/%' then raise exception 'Invalid file' using errcode = '22023'; end if;
  update public.partner_contracts set status = 'both_signed', signed_file = p_file, signed_uploaded_at = now(), signed_uploaded_by = (select auth.uid())
    where id = p_id;
  if v_by_partner and v_contract.account_id is not null then
    insert into public.notifications (recipient_user_id, type, message, related_entity_type, related_entity_id)
      values (v_contract.account_id, 'contract_semnat', left(v_contract.business_name || ' a încărcat contractul semnat: ' || v_contract.title || '.', 500), 'contract', p_id);
  end if;
  return true;
end
$function$;

-- Returns the files to remove from storage; only the agent or admin can delete a contract.
CREATE FUNCTION private.delete_partner_contract(p_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_contract record;
begin
  select partner_id, supplier_file, signed_file into v_contract from public.partner_contracts where id = p_id;
  if not found or not private.can_manage_partner(v_contract.partner_id) then return null; end if;
  delete from public.partner_contracts where id = p_id;
  return array_remove(array[v_contract.supplier_file, v_contract.signed_file], null);
end
$function$;

CREATE FUNCTION private.save_custody_item(p_id uuid, p_partner_id uuid, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_location uuid := nullif(p_data->>'location_id', '')::uuid;
  v_kind text := p_data->>'kind';
  v_handed date := coalesce(nullif(p_data->>'handed_on', '')::date, current_date);
  v_trial_days integer := coalesce(nullif(p_data->>'trial_days', '')::integer, 30);
begin
  if not private.can_manage_partner(p_partner_id) then return null; end if;
  if v_location is not null and not exists (select 1 from public.partner_locations where id = v_location and partner_id = p_partner_id) then
    raise exception 'Invalid point' using errcode = '22023';
  end if;
  if v_kind not in ('tester', 'pos', 'trial') or v_trial_days not between 1 and 365 then raise exception 'Invalid item' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.partner_custody_items (partner_id, location_id, kind, product_id, name, quantity, unit_value, handed_on, trial_ends_on, note, created_by)
      values (p_partner_id, v_location, v_kind, nullif(p_data->>'product_id', '')::uuid, btrim(p_data->>'name'), (p_data->>'quantity')::integer,
        nullif(p_data->>'unit_value', '')::numeric, v_handed, case when v_kind = 'trial' then v_handed + v_trial_days end,
        nullif(btrim(coalesce(p_data->>'note', '')), ''), (select auth.uid()))
      returning id into v_id;
  else
    update public.partner_custody_items set location_id = v_location, kind = v_kind, product_id = nullif(p_data->>'product_id', '')::uuid,
      name = btrim(p_data->>'name'), quantity = (p_data->>'quantity')::integer, unit_value = nullif(p_data->>'unit_value', '')::numeric,
      handed_on = v_handed, trial_ends_on = case when v_kind = 'trial' then v_handed + v_trial_days end,
      trial_notified_at = case when v_kind = 'trial' and trial_ends_on is distinct from v_handed + v_trial_days then null else trial_notified_at end,
      note = nullif(btrim(coalesce(p_data->>'note', '')), ''), updated_at = now()
      where id = p_id and partner_id = p_partner_id
      returning id into v_id;
  end if;
  return v_id;
end
$function$;

-- returned / missing / converted (a trial that became a sale) close the item; at_client reopens it.
CREATE FUNCTION private.set_custody_status(p_id uuid, p_status text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_partner uuid;
begin
  select partner_id into v_partner from public.partner_custody_items where id = p_id;
  if v_partner is null or not private.can_manage_partner(v_partner) then return false; end if;
  if p_status not in ('at_client', 'returned', 'missing', 'converted') then raise exception 'Invalid status' using errcode = '22023'; end if;
  update public.partner_custody_items set status = p_status, closed_on = case when p_status = 'at_client' then null else current_date end, updated_at = now()
    where id = p_id;
  return true;
end
$function$;

CREATE FUNCTION private.delete_custody_item(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_partner uuid;
begin
  select partner_id into v_partner from public.partner_custody_items where id = p_id;
  if v_partner is null or not private.can_manage_partner(v_partner) then return false; end if;
  delete from public.partner_custody_items where id = p_id;
  return true;
end
$function$;

-- Trials ending within 3 days: the agent is told once to convert the client or take the diffuser back.
CREATE FUNCTION private.remind_custody_trials()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_count integer;
begin
  with due as (
    update public.partner_custody_items i set trial_notified_at = now()
    from public.partners p
    where p.id = i.partner_id and i.kind = 'trial' and i.status = 'at_client' and i.trial_notified_at is null
      and i.trial_ends_on <= current_date + 3 and p.account_id is not null
    returning p.account_id, p.business_name, i.name, i.trial_ends_on, i.id
  )
  insert into public.notifications (recipient_user_id, type, message, related_entity_type, related_entity_id)
    select account_id, 'proba_expira', left('Proba la ' || business_name || ' (' || name || ') se încheie pe ' || to_char(trial_ends_on, 'DD.MM.YYYY')
      || '. Marchează clientul convertit sau ia produsul înapoi.', 500), 'custody', id
    from due;
  get diagnostics v_count = row_count;
  return v_count;
end
$function$;
revoke all on function private.remind_custody_trials() from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array['record_partner_contract(uuid, uuid, text, text)', 'record_signed_contract(uuid, text)', 'delete_partner_contract(uuid)',
      'save_custody_item(uuid, uuid, jsonb)', 'set_custody_status(uuid, text)', 'delete_custody_item(uuid)'] loop
    execute format('revoke all on function private.%s from public, anon', f);
    execute format('grant execute on function private.%s to authenticated', f);
  end loop;
end $$;

CREATE FUNCTION public.record_partner_contract(p_id uuid, p_partner_id uuid, p_title text, p_file text) RETURNS boolean LANGUAGE sql SET search_path TO ''
AS $function$ select private.record_partner_contract(p_id, p_partner_id, p_title, p_file) $function$;
CREATE FUNCTION public.record_signed_contract(p_id uuid, p_file text) RETURNS boolean LANGUAGE sql SET search_path TO ''
AS $function$ select private.record_signed_contract(p_id, p_file) $function$;
CREATE FUNCTION public.delete_partner_contract(p_id uuid) RETURNS text[] LANGUAGE sql SET search_path TO ''
AS $function$ select private.delete_partner_contract(p_id) $function$;
CREATE FUNCTION public.save_custody_item(p_id uuid, p_partner_id uuid, p_data jsonb) RETURNS uuid LANGUAGE sql SET search_path TO ''
AS $function$ select private.save_custody_item(p_id, p_partner_id, p_data) $function$;
CREATE FUNCTION public.set_custody_status(p_id uuid, p_status text) RETURNS boolean LANGUAGE sql SET search_path TO ''
AS $function$ select private.set_custody_status(p_id, p_status) $function$;
CREATE FUNCTION public.delete_custody_item(p_id uuid) RETURNS boolean LANGUAGE sql SET search_path TO ''
AS $function$ select private.delete_custody_item(p_id) $function$;
do $$
declare f text;
begin
  foreach f in array array['record_partner_contract(uuid, uuid, text, text)', 'record_signed_contract(uuid, text)', 'delete_partner_contract(uuid)',
      'save_custody_item(uuid, uuid, jsonb)', 'set_custody_status(uuid, text)', 'delete_custody_item(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Trial reminders run with the lead reminders, every 15 minutes.
select cron.schedule('lead-offer-reminders', '*/15 * * * *', 'select private.remind_lead_offers(), private.alert_stale_leads(), private.remind_custody_trials()');
