-- Digital Vouchers: campaign vouchers (one shared discount code per campaign) shown on a landing page and
-- saved to Google Wallet (Apple Wallet later). Administrators and marketing users manage them; the public
-- API (route handlers on the server) reads only the published fields with the service client.

create function private.can_manage_vouchers() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select private.current_role())::text in ('admin', 'marketing'), false) $$;
revoke all on function private.can_manage_vouchers() from public, anon;
grant execute on function private.can_manage_vouchers() to authenticated;

create table public.digital_vouchers (
  id uuid primary key default gen_random_uuid(),
  -- General
  name text not null constraint digital_vouchers_name_check check (char_length(btrim(name)) between 1 and 120),
  internal_name text not null default '' constraint digital_vouchers_internal_name_check check (char_length(internal_name) <= 120),
  brand text not null constraint digital_vouchers_brand_check check (char_length(btrim(brand)) between 1 and 60),
  slug text not null constraint digital_vouchers_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  discount_code text not null constraint digital_vouchers_code_check check (discount_code ~ '^[A-Za-z0-9_-]{2,40}$'),
  discount_type text not null default 'percentage' constraint digital_vouchers_type_check check (discount_type in ('percentage', 'fixed_amount')),
  discount_value numeric(10,2) not null constraint digital_vouchers_value_check check (discount_value > 0),
  currency text constraint digital_vouchers_currency_check check (currency ~ '^[A-Z]{3}$'),
  short_description text not null default '' constraint digital_vouchers_short_check check (char_length(short_description) <= 300),
  long_description text not null default '' constraint digital_vouchers_long_check check (char_length(long_description) <= 2000),
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  -- The zone the dates were entered in and are shown in.
  timezone text not null default 'Europe/Bucharest' constraint digital_vouchers_timezone_check check (char_length(timezone) between 3 and 60),
  -- Language of the fixed labels the voucher shows (Wallet field names, image), not of the texts typed in.
  language text not null default 'ro' constraint digital_vouchers_language_check check (language in ('ro', 'en')),
  terms text not null default '' constraint digital_vouchers_terms_check check (char_length(terms) <= 3000),
  internal_notes text not null default '' constraint digital_vouchers_notes_check check (char_length(internal_notes) <= 3000),
  -- Design
  logo_path text constraint digital_vouchers_logo_check check (logo_path ~ '^vouchers/[0-9a-f-]{36}\.(jpg|png)$'),
  hero_path text constraint digital_vouchers_hero_check check (hero_path ~ '^vouchers/[0-9a-f-]{36}\.(jpg|png)$'),
  background_color text not null default '#651F2C' constraint digital_vouchers_bg_check check (background_color ~ '^#[0-9A-Fa-f]{6}$'),
  text_color text not null default '#F5EEE4' constraint digital_vouchers_text_check check (text_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text not null default '#D8BE98' constraint digital_vouchers_accent_check check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  title text not null default '' constraint digital_vouchers_title_check check (char_length(title) <= 80),
  subtitle text not null default '' constraint digital_vouchers_subtitle_check check (char_length(subtitle) <= 160),
  show_discount_value boolean not null default true,
  show_discount_code boolean not null default true,
  -- Distribution
  website_url text constraint digital_vouchers_website_check check (website_url ~ '^https://'),
  landing_url text constraint digital_vouchers_landing_check check (landing_url ~ '^https://'),
  discount_url text constraint digital_vouchers_discount_url_check check (discount_url ~ '^https://'),
  qr_url text constraint digital_vouchers_qr_check check (qr_url ~ '^https://'),
  utm_source text not null default '' constraint digital_vouchers_utm_source_check check (utm_source ~ '^[A-Za-z0-9_.-]{0,60}$'),
  utm_medium text not null default '' constraint digital_vouchers_utm_medium_check check (utm_medium ~ '^[A-Za-z0-9_.-]{0,60}$'),
  utm_campaign text not null default '' constraint digital_vouchers_utm_campaign_check check (utm_campaign ~ '^[A-Za-z0-9_.-]{0,80}$'),
  -- Extra sites allowed to call the public API from a browser (CORS), besides the website and landing page.
  extra_origins text[] not null default '{}' constraint digital_vouchers_origins_check check (cardinality(extra_origins) <= 10),
  google_wallet_enabled boolean not null default false,
  apple_wallet_enabled boolean not null default false,
  image_download_enabled boolean not null default true,
  email_enabled boolean not null default false,
  -- Lifecycle: a draft is invisible to the public API; scheduled / active / expired follow from the dates.
  published boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.app_users(id) on delete set null,
  constraint digital_vouchers_slug_key unique (slug),
  constraint digital_vouchers_dates_check check (expires_at > starts_at),
  constraint digital_vouchers_currency_needed check (discount_type = 'percentage' or currency is not null),
  constraint digital_vouchers_percent_check check (discount_type <> 'percentage' or discount_value <= 100)
);

-- The Wallet objects a voucher has at Google (and later Apple): one class and one shared object per platform.
create table public.digital_voucher_wallet_resources (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references public.digital_vouchers(id) on delete cascade,
  platform text not null constraint dv_wallet_platform_check check (platform in ('google', 'apple')),
  resource_type text not null constraint dv_wallet_type_check check (resource_type in ('class', 'object', 'pass')),
  external_id text not null constraint dv_wallet_external_id_check check (char_length(external_id) between 3 and 200),
  sync_status text not null default 'pending' constraint dv_wallet_status_check check (sync_status in ('pending', 'synced', 'error')),
  -- Hash of the last payload sent, so an unchanged voucher is not sent again.
  payload_hash text,
  last_synced_at timestamptz,
  last_error text constraint dv_wallet_error_check check (char_length(last_error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dv_wallet_resource_key unique (voucher_id, platform, resource_type),
  constraint dv_wallet_external_key unique (platform, external_id)
);

-- Anonymous analytics: no IP addresses, no personal data. session_id is a random id the landing page keeps.
create table public.digital_voucher_events (
  id bigint generated always as identity primary key,
  voucher_id uuid not null references public.digital_vouchers(id) on delete cascade,
  event_type text not null constraint dv_events_type_check check (event_type in (
    'landing_page_view', 'discount_code_copy', 'shop_now_click', 'google_wallet_request', 'google_wallet_link_generated',
    'apple_wallet_request', 'voucher_image_download', 'email_voucher_requested', 'email_voucher_sent')),
  occurred_at timestamptz not null default now(),
  session_id text constraint dv_events_session_check check (session_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  utm_source text constraint dv_events_utm_source_check check (char_length(utm_source) <= 100),
  utm_medium text constraint dv_events_utm_medium_check check (char_length(utm_medium) <= 100),
  utm_campaign text constraint dv_events_utm_campaign_check check (char_length(utm_campaign) <= 100),
  device_type text not null default 'unknown' constraint dv_events_device_check check (device_type in ('mobile', 'tablet', 'desktop', 'unknown')),
  -- Only the referring site's host name, never the full address.
  referrer_host text constraint dv_events_referrer_check check (char_length(referrer_host) <= 255)
);
create index digital_voucher_events_voucher_idx on public.digital_voucher_events (voucher_id, event_type, occurred_at);
create index digital_voucher_events_time_idx on public.digital_voucher_events (occurred_at);

-- Who changed what on a voucher (create, update, archive, publish, wallet sync).
create table public.digital_voucher_audit (
  id bigint generated always as identity primary key,
  voucher_id uuid references public.digital_vouchers(id) on delete set null,
  action text not null constraint dv_audit_action_check check (char_length(action) between 1 and 40),
  changed_fields text[] not null default '{}',
  actor_id uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index digital_voucher_audit_voucher_idx on public.digital_voucher_audit (voucher_id, created_at desc);

-- Fixed-window request counters for the public API, keyed by a salted hash (never the IP itself).
create table public.digital_voucher_rate_limits (
  key text not null constraint dv_rate_key_check check (key ~ '^[a-f0-9]{16,128}$'),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

-- Records every insert/update of a voucher in the audit table (the names of the fields that changed).
create function private.digital_voucher_audit_trigger() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  fields text[];
  verb text;
begin
  if tg_op = 'INSERT' then
    verb := 'create';
    fields := '{}';
  else
    select coalesce(array_agg(n.key order by n.key), '{}') into fields
    from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value and n.key not in ('updated_at', 'updated_by');
    if cardinality(fields) = 0 then return new; end if;
    verb := case
      when old.archived_at is null and new.archived_at is not null then 'archive'
      when old.archived_at is not null and new.archived_at is null then 'restore'
      when old.published is distinct from new.published then case when new.published then 'publish' else 'unpublish' end
      else 'update' end;
  end if;
  insert into public.digital_voucher_audit (voucher_id, action, changed_fields, actor_id)
  values (new.id, verb, fields, coalesce(new.updated_by, new.created_by));
  return new;
end $$;
create trigger digital_vouchers_audit after insert or update on public.digital_vouchers
  for each row execute function private.digital_voucher_audit_trigger();

-- Counts one public request; true while the key stays within the limit for the current window. Old windows
-- are dropped as it goes. Only the server (service role) calls it.
create function public.digital_voucher_rate_hit(p_key text, p_limit integer, p_window_seconds integer) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  started timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  count_now integer;
begin
  insert into public.digital_voucher_rate_limits (key, window_start, hits) values (p_key, started, 1)
  on conflict (key, window_start) do update set hits = public.digital_voucher_rate_limits.hits + 1
  returning hits into count_now;
  if random() < 0.02 then
    delete from public.digital_voucher_rate_limits where window_start < now() - interval '1 day';
  end if;
  return count_now <= p_limit;
end $$;
revoke all on function public.digital_voucher_rate_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.digital_voucher_rate_hit(text, integer, integer) to service_role;

-- Totals and unique sessions per voucher and event type, for the Overview (managers only).
create function public.digital_voucher_stats(p_voucher_id uuid default null)
returns table (voucher_id uuid, event_type text, total bigint, sessions bigint)
language sql stable security invoker set search_path = ''
as $$
  select e.voucher_id, e.event_type, count(*), count(distinct e.session_id)
  from public.digital_voucher_events e
  where p_voucher_id is null or e.voucher_id = p_voucher_id
  group by e.voucher_id, e.event_type
$$;
revoke all on function public.digital_voucher_stats(uuid) from public, anon;
grant execute on function public.digital_voucher_stats(uuid) to authenticated;

alter table public.digital_vouchers enable row level security;
alter table public.digital_voucher_wallet_resources enable row level security;
alter table public.digital_voucher_events enable row level security;
alter table public.digital_voucher_audit enable row level security;
alter table public.digital_voucher_rate_limits enable row level security;

create policy voucher_managers on public.digital_vouchers for all to authenticated
  using ((select private.can_manage_vouchers())) with check ((select private.can_manage_vouchers()));
create policy voucher_managers on public.digital_voucher_wallet_resources for all to authenticated
  using ((select private.can_manage_vouchers())) with check ((select private.can_manage_vouchers()));
-- Events are written only by the server (public API); managers read them.
create policy voucher_managers_read on public.digital_voucher_events for select to authenticated
  using ((select private.can_manage_vouchers()));
create policy voucher_managers_read on public.digital_voucher_audit for select to authenticated
  using ((select private.can_manage_vouchers()));
-- Rate limits: no policy, only the service role touches them.

revoke all on public.digital_vouchers, public.digital_voucher_wallet_resources, public.digital_voucher_events,
  public.digital_voucher_audit, public.digital_voucher_rate_limits from anon;
revoke all on public.digital_voucher_events, public.digital_voucher_audit, public.digital_voucher_rate_limits from authenticated;
grant select, insert, update on public.digital_vouchers to authenticated;
grant select, insert, update, delete on public.digital_voucher_wallet_resources to authenticated;
grant select on public.digital_voucher_events, public.digital_voucher_audit to authenticated;

-- Voucher graphics (logo, hero): a PUBLIC bucket, because Google Wallet fetches the images over HTTPS without
-- signing in. Only managers can upload or delete; JPEG/PNG, at most 5 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('digital-voucher-assets', 'digital-voucher-assets', true, 5242880, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy digital_voucher_assets_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'digital-voucher-assets' and (select private.can_manage_vouchers())
    and name ~ '^vouchers/[0-9a-f-]{36}\.(jpg|png)$');
create policy digital_voucher_assets_delete on storage.objects for delete to authenticated
  using (bucket_id = 'digital-voucher-assets' and (select private.can_manage_vouchers()));
