-- Accounting module (Contabilitate): a temporary hand-over space for documents (supplier invoices, Shopify
-- fee invoices and payout reports) to the accountant. Not an archive: every file is deleted 30 days after it
-- was collected; minimal metadata stays for history and de-duplication.
-- Files live in the private bucket "accounting-documents" and are reached only through the app (signed URLs
-- made on the server after an access check). Writes go through the server (service role, after an explicit
-- role check) or through the functions below; reads are guarded by row security.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('accounting-documents', 'accounting-documents', false, 26214400,
  array['application/pdf', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'])
on conflict (id) do nothing;

-- The beneficiary companies (ours) a document belongs to.
create table public.accounting_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique constraint accounting_companies_name_check check (char_length(name) between 2 and 160),
  vat_id text constraint accounting_companies_vat_check check (vat_id is null or char_length(vat_id) <= 20),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Which companies an accounting user may see.
create table public.accounting_company_access (
  user_id uuid not null references public.app_users(id) on delete cascade,
  company_id uuid not null references public.accounting_companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, company_id)
);

create table public.accounting_suppliers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique constraint accounting_suppliers_slug_check check (slug ~ '^[a-z0-9_]{2,40}$'),
  name text not null constraint accounting_suppliers_name_check check (char_length(name) between 2 and 120),
  -- Hostnames the Capture extension recognises the supplier by (a page on a subdomain matches too).
  domains text[] not null default '{}',
  default_doc_type text not null default 'external_invoice',
  sort integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- One collection source per supplier. method: api | email | extension | manual.
-- status: not_configured (needs a connector or credentials), available (works today: extension or manual
-- upload), connected (an API connector with valid credentials), error.
create table public.accounting_integrations (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null unique references public.accounting_suppliers(id) on delete cascade,
  method text not null constraint accounting_integrations_method_check check (method in ('api', 'email', 'extension', 'manual')),
  status text not null default 'not_configured' constraint accounting_integrations_status_check check (status in ('not_configured', 'available', 'connected', 'error')),
  supports_sync boolean not null default false,
  last_sync_at timestamptz,
  last_document_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);

create table public.accounting_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.accounting_companies(id),
  supplier_id uuid not null references public.accounting_suppliers(id),
  doc_type text not null constraint accounting_documents_type_check check (doc_type in ('external_invoice', 'shopify_fees_invoice', 'shopify_payout_report', 'other')),
  invoice_number text constraint accounting_documents_invoice_check check (invoice_number is null or char_length(invoice_number) <= 80),
  issued_on date,
  -- Accounting period, YYYY-MM.
  period text not null constraint accounting_documents_period_check check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  original_name text not null constraint accounting_documents_name_check check (char_length(original_name) between 1 and 255),
  mime_type text not null,
  size_bytes integer not null constraint accounting_documents_size_check check (size_bytes > 0),
  sha256 text not null constraint accounting_documents_hash_check check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text,
  collection_method text not null constraint accounting_documents_method_check check (collection_method in ('api', 'email', 'extension', 'manual')),
  collected_at timestamptz not null default now(),
  collected_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  last_downloaded_at timestamptz,
  download_count integer not null default 0,
  external_id text constraint accounting_documents_external_check check (external_id is null or char_length(external_id) <= 200),
  -- Set when the retention job deleted the file; the row then stays as history only.
  file_deleted_at timestamptz,
  notes text constraint accounting_documents_notes_check check (notes is null or char_length(notes) <= 500)
);
create index accounting_documents_list_idx on public.accounting_documents (company_id, collected_at desc);
create index accounting_documents_expiry_idx on public.accounting_documents (expires_at) where file_deleted_at is null;
-- De-duplication among the files still held: the same bytes, the same supplier document id or invoice number.
create unique index accounting_documents_hash_key on public.accounting_documents (sha256) where file_deleted_at is null;
create unique index accounting_documents_external_key on public.accounting_documents (supplier_id, external_id) where external_id is not null and file_deleted_at is null;
create unique index accounting_documents_invoice_key on public.accounting_documents (supplier_id, lower(invoice_number)) where invoice_number is not null and file_deleted_at is null;

-- History: collections, duplicates, rejected uploads, downloads, expiries.
create table public.accounting_document_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.accounting_documents(id) on delete set null,
  supplier_id uuid references public.accounting_suppliers(id) on delete set null,
  action text not null constraint accounting_events_action_check check (action in ('collected', 'duplicate', 'rejected', 'downloaded', 'downloaded_zip', 'expired', 'expiry_failed')),
  method text,
  user_id uuid references auth.users(id) on delete set null,
  detail text constraint accounting_events_detail_check check (detail is null or char_length(detail) <= 500),
  created_at timestamptz not null default now()
);
create index accounting_events_document_idx on public.accounting_document_events (document_id, created_at desc);
create index accounting_events_recent_idx on public.accounting_document_events (created_at desc);

-- Runs of automatic connectors (API / email); errors stay here for the Integrations page.
create table public.accounting_sync_runs (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.accounting_integrations(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' constraint accounting_sync_status_check check (status in ('running', 'ok', 'error')),
  collected integer not null default 0,
  duplicates integer not null default 0,
  error text,
  triggered_by uuid references auth.users(id) on delete set null
);
create index accounting_sync_runs_idx on public.accounting_sync_runs (integration_id, started_at desc);

-- BoldHub Capture: a revocable, expiring token per connected browser. Only its SHA-256 is stored.
create table public.accounting_capture_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  label text not null default 'Chrome' constraint accounting_capture_label_check check (char_length(label) <= 80),
  token_hash text not null unique constraint accounting_capture_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index accounting_capture_tokens_user_idx on public.accounting_capture_tokens (user_id);

-- Access ---------------------------------------------------------------------------------------------

-- Admin sees every company; an accounting user only the companies it was given.
CREATE FUNCTION private.can_view_accounting_company(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (select auth.uid()) is not null and (
    coalesce((select private.current_role()) = 'admin', false)
    or (coalesce((select private.current_role()) = 'contabilitate', false)
      and exists (select 1 from public.accounting_company_access a join public.accounting_companies c on c.id = a.company_id
        where a.user_id = (select auth.uid()) and a.company_id = p_company_id and c.active)))
$function$;
revoke all on function private.can_view_accounting_company(uuid) from public, anon;
grant execute on function private.can_view_accounting_company(uuid) to authenticated;

alter table public.accounting_companies enable row level security;
alter table public.accounting_company_access enable row level security;
alter table public.accounting_suppliers enable row level security;
alter table public.accounting_integrations enable row level security;
alter table public.accounting_documents enable row level security;
alter table public.accounting_document_events enable row level security;
alter table public.accounting_sync_runs enable row level security;
alter table public.accounting_capture_tokens enable row level security;

create policy accounting_read on public.accounting_companies for select to authenticated
  using ((select private.can_view_accounting_company(id)));
create policy admin_read on public.accounting_company_access for select to authenticated
  using ((select private.current_role()) = 'admin' or user_id = (select auth.uid()));
create policy accounting_read on public.accounting_suppliers for select to authenticated
  using ((select private.current_role()) = any (array['admin'::public.user_role, 'contabilitate'::public.user_role]));
-- Integrations, sync runs, history and tokens: administrator only (the accountant never sees how sources connect).
create policy admin_read on public.accounting_integrations for select to authenticated
  using ((select private.current_role()) = 'admin');
create policy admin_read on public.accounting_sync_runs for select to authenticated
  using ((select private.current_role()) = 'admin');
create policy admin_read on public.accounting_document_events for select to authenticated
  using ((select private.current_role()) = 'admin');
create policy own_tokens on public.accounting_capture_tokens for select to authenticated
  using ((select private.current_role()) = 'admin' and user_id = (select auth.uid()));
create policy accounting_read on public.accounting_documents for select to authenticated
  using ((select private.can_view_accounting_company(company_id)));

-- Downloads (single file or ZIP) are recorded by the reader; only documents it may see, with the file still held.
CREATE FUNCTION private.record_accounting_downloads(p_ids uuid[], p_zip boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_count integer;
begin
  if (select auth.uid()) is null or coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 500 then return 0; end if;
  with done as (
    update public.accounting_documents d set last_downloaded_at = now(), download_count = d.download_count + 1
    where d.id = any(p_ids) and d.file_deleted_at is null and private.can_view_accounting_company(d.company_id)
    returning d.id, d.supplier_id
  )
  insert into public.accounting_document_events (document_id, supplier_id, action, user_id)
    select id, supplier_id, case when p_zip then 'downloaded_zip' else 'downloaded' end, (select auth.uid()) from done;
  get diagnostics v_count = row_count;
  return v_count;
end
$function$;
revoke all on function private.record_accounting_downloads(uuid[], boolean) from public, anon;
grant execute on function private.record_accounting_downloads(uuid[], boolean) to authenticated;
CREATE FUNCTION public.record_accounting_downloads(p_ids uuid[], p_zip boolean) RETURNS integer LANGUAGE sql SET search_path TO ''
AS $function$ select private.record_accounting_downloads(p_ids, p_zip) $function$;
revoke all on function public.record_accounting_downloads(uuid[], boolean) from public, anon;
grant execute on function public.record_accounting_downloads(uuid[], boolean) to authenticated;

-- Retention: every morning the app deletes the files of expired documents (Storage) and marks them.
select cron.schedule('accounting-expiry', '15 3 * * *', 'select private.call_app(''/api/cron/accounting-expiry'')');

-- Starting data ---------------------------------------------------------------------------------------

insert into public.accounting_companies (name, vat_id) values
  ('BOLD DESIGN COLLECTION S.R.L.', 'RO42910222'),
  ('ESSENZA ATELIER S.R.L.', 'RO55508848')
on conflict (name) do nothing;

insert into public.accounting_suppliers (slug, name, domains, default_doc_type, sort) values
  ('meta_ads', 'Meta Ads', array['facebook.com', 'meta.com'], 'external_invoice', 10),
  ('tiktok_ads', 'TikTok Ads', array['ads.tiktok.com', 'business.tiktok.com'], 'external_invoice', 20),
  ('google_ads', 'Google Ads', array['ads.google.com', 'payments.google.com'], 'external_invoice', 30),
  ('shopify_billing', 'Shopify Billing', array['admin.shopify.com', 'myshopify.com'], 'external_invoice', 40),
  ('shopify_payments_fees', 'Shopify Payments – facturi comisioane', array[]::text[], 'shopify_fees_invoice', 50),
  ('shopify_payouts', 'Shopify Payments – payout-uri', array[]::text[], 'shopify_payout_report', 60),
  ('mailerlite', 'MailerLite', array['mailerlite.com'], 'external_invoice', 70),
  ('adobe', 'Adobe', array['adobe.com'], 'external_invoice', 80),
  ('anthropic', 'Anthropic / Claude', array['claude.ai', 'anthropic.com'], 'external_invoice', 90),
  ('openai_chatgpt', 'OpenAI / ChatGPT', array['chatgpt.com'], 'external_invoice', 100),
  ('other', 'Alt furnizor', array[]::text[], 'other', 900)
on conflict (slug) do nothing;

-- Today every supplier can be collected by hand or with the Capture extension; the Shopify Payments sources
-- will get an API connector (stage 3) and stay "not configured" until then.
insert into public.accounting_integrations (supplier_id, method, status, note)
  select s.id,
    case when s.slug in ('shopify_payments_fees', 'shopify_payouts') then 'api' when s.slug = 'other' then 'manual' else 'extension' end,
    case when s.slug in ('shopify_payments_fees', 'shopify_payouts') then 'not_configured' else 'available' end,
    case when s.slug in ('shopify_payments_fees', 'shopify_payouts') then 'Conector Shopify Payments API – etapa următoare. Până atunci: încărcare manuală.' end
  from public.accounting_suppliers s
on conflict (supplier_id) do nothing;
