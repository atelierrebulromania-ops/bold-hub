-- Client discounts per product instead of per category: one rule on the whole range (no product) plus one rule per product.
alter table public.partner_discounts add column if not exists product_id uuid references public.products(id) on delete cascade;
alter table public.partner_discounts add constraint partner_discounts_target_check check (category is null or product_id is null);
create index if not exists partner_discounts_product_idx on public.partner_discounts (product_id);

alter table public.partner_discounts drop constraint partner_discounts_partner_id_category_key;
create unique index partner_discounts_general_key on public.partner_discounts (partner_id, channel) where category is null and product_id is null;
create unique index partner_discounts_product_key on public.partner_discounts (partner_id, channel, product_id) where product_id is not null;
create unique index partner_discounts_category_key on public.partner_discounts (partner_id, channel, category) where category is not null;

-- Existing category rules become the same discount on each active product of that category (a product's own rule wins).
insert into public.partner_discounts (partner_id, channel, product_id, percent)
  select d.partner_id, d.channel, p.id, d.percent
  from public.partner_discounts d
  join public.products p on p.active and lower(p.category) = lower(d.category)
  where d.category is not null
  on conflict do nothing;
delete from public.partner_discounts where category is not null;

create or replace function private.save_partner_discounts(p_partner_id uuid, p_rules jsonb, p_channel text default 'resale', p_own boolean default true)
returns boolean language plpgsql security definer set search_path to '' as $$
begin
  if not private.can_manage_partner(p_partner_id) then return false; end if;
  if p_channel is null or p_channel not in ('resale', 'consumption') then raise exception 'Invalid channel' using errcode = '22023'; end if;
  if jsonb_typeof(p_rules) is distinct from 'array' or jsonb_array_length(p_rules) > 1000 then
    raise exception 'Invalid rules' using errcode = '22023';
  end if;
  delete from public.partner_discounts where partner_id = p_partner_id and channel = p_channel;
  if p_channel = 'consumption' then
    update public.partners set own_consumption_discounts = coalesce(p_own, false) where id = p_partner_id;
    if not coalesce(p_own, false) then return true; end if;
  end if;
  -- A rule without product_id is the one on the whole range; product rules must name an existing product.
  insert into public.partner_discounts (partner_id, channel, product_id, percent)
    select p_partner_id, p_channel, case when nullif(r->>'product_id', '') is null then null else (r->>'product_id')::uuid end, (r->>'percent')::numeric
    from jsonb_array_elements(p_rules) r
    where (r->>'percent') ~ '^\d{1,2}(\.\d{1,2})?$' and (r->>'percent')::numeric > 0
      and (nullif(r->>'product_id', '') is null
        or ((r->>'product_id') ~ '^[0-9a-f-]{36}$' and exists (select 1 from public.products p where p.id = (r->>'product_id')::uuid)));
  return true;
end
$$;
