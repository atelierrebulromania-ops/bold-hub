-- Discounts per order channel. By default consumption uses the resale rules; a client can get its own
-- consumption rules (possibly none = no discount on consumption).
alter table public.partner_discounts add column channel text not null default 'resale'
  constraint partner_discounts_channel_check check (channel in ('resale', 'consumption'));
alter table public.partner_discounts drop constraint partner_discounts_partner_id_category_key;
alter table public.partner_discounts add constraint partner_discounts_partner_id_category_key
  unique nulls not distinct (partner_id, channel, category);
alter table public.partners add column own_consumption_discounts boolean not null default false;

drop function public.save_partner_discounts(uuid, jsonb);
drop function private.save_partner_discounts(uuid, jsonb);

-- p_own only matters for consumption: false = consumption uses the resale rules (its own rules are cleared).
CREATE FUNCTION private.save_partner_discounts(p_partner_id uuid, p_rules jsonb, p_channel text DEFAULT 'resale', p_own boolean DEFAULT true)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.can_manage_partner(p_partner_id) then return false; end if;
  if p_channel is null or p_channel not in ('resale', 'consumption') then raise exception 'Invalid channel' using errcode = '22023'; end if;
  if jsonb_typeof(p_rules) is distinct from 'array' or jsonb_array_length(p_rules) > 100 then
    raise exception 'Invalid rules' using errcode = '22023';
  end if;
  delete from public.partner_discounts where partner_id = p_partner_id and channel = p_channel;
  if p_channel = 'consumption' then
    update public.partners set own_consumption_discounts = coalesce(p_own, false) where id = p_partner_id;
    if not coalesce(p_own, false) then return true; end if;
  end if;
  insert into public.partner_discounts (partner_id, channel, category, percent)
    select p_partner_id, p_channel, nullif(btrim(r->>'category'), ''), (r->>'percent')::numeric
    from jsonb_array_elements(p_rules) r
    where (r->>'percent') ~ '^\d{1,2}(\.\d{1,2})?$' and (r->>'percent')::numeric > 0;
  return true;
end
$function$;
revoke all on function private.save_partner_discounts(uuid, jsonb, text, boolean) from public, anon;
grant execute on function private.save_partner_discounts(uuid, jsonb, text, boolean) to authenticated;

CREATE FUNCTION public.save_partner_discounts(p_partner_id uuid, p_rules jsonb, p_channel text DEFAULT 'resale', p_own boolean DEFAULT true)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select private.save_partner_discounts(p_partner_id, p_rules, p_channel, p_own) $function$;
revoke all on function public.save_partner_discounts(uuid, jsonb, text, boolean) from public, anon;
grant execute on function public.save_partner_discounts(uuid, jsonb, text, boolean) to authenticated, service_role;
