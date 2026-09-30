-- Due date and payment of B2B invoices (carts and proformas invoiced directly), read from BOCP:
-- stored when billing links the invoice, then refreshed for unpaid invoices (BOCP does not mark an
-- invoice modified when a payment comes in, so they are re-read one by one).
alter table public.partner_carts
  add column invoice_due_date date,
  add column invoice_total numeric(12,2),
  add column invoice_rest numeric(12,2),
  add column invoice_last_payment_date date,
  add column payment_checked_at timestamptz;
alter table public.sales_documents
  add column invoice_due_date date,
  add column invoice_total numeric(12,2),
  add column invoice_rest numeric(12,2),
  add column invoice_last_payment_date date,
  add column payment_checked_at timestamptz;

-- Who keeps payments up to date: billing, the owner and the admin, or the scheduled job (service role).
create function private.can_track_payments()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce((select auth.role()) = 'service_role', false)
    or ((select auth.uid()) is not null and coalesce((select private.current_role()) in ('admin', 'operator_facturare', 'owner'), false))
$$;

-- Invoices whose payment should be re-read: not known paid, not checked in the last hour.
create function private.invoices_to_check(p_limit integer)
returns table(source text, id uuid, bocp_invoice_id text)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not private.can_track_payments() then return; end if;
  return query
    select x.source, x.id, x.bocp_invoice_id from (
      select 'cart'::text as source, c.id, c.bocp_invoice_id, c.payment_checked_at
        from public.partner_carts c
        where c.bocp_invoice_id is not null and (c.invoice_rest is null or c.invoice_rest > 0)
      union all
      select 'document'::text, d.id, d.bocp_invoice_id, d.payment_checked_at
        from public.sales_documents d
        where d.bocp_invoice_id is not null and (d.invoice_rest is null or d.invoice_rest > 0)
    ) x
    where x.payment_checked_at is null or x.payment_checked_at < now() - interval '1 hour'
    order by x.payment_checked_at nulls first
    limit least(greatest(coalesce(p_limit, 20), 1), 100);
end
$$;

create function private.record_invoice_payment(p_source text, p_id uuid, p_due_date date, p_total numeric, p_rest numeric, p_last_payment date)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not private.can_track_payments() then return false; end if;
  if p_source = 'cart' then
    update public.partner_carts set invoice_due_date = p_due_date, invoice_total = p_total, invoice_rest = greatest(p_rest, 0),
      invoice_last_payment_date = p_last_payment, payment_checked_at = now()
    where id = p_id and bocp_invoice_id is not null;
  elsif p_source = 'document' then
    update public.sales_documents set invoice_due_date = p_due_date, invoice_total = p_total, invoice_rest = greatest(p_rest, 0),
      invoice_last_payment_date = p_last_payment, payment_checked_at = now()
    where id = p_id and bocp_invoice_id is not null;
  else
    return false;
  end if;
  return found;
end
$$;

-- The owner's view of what the B2B clients still owe (the admin can open it in dev mode).
create function private.b2b_receivables()
returns table(source text, id uuid, partner_name text, agent_name text, invoice_number text, invoice_date date,
  due_date date, total numeric, rest numeric, payment_checked_at timestamptz)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if (select auth.uid()) is null or not coalesce((select private.current_role()) in ('owner', 'admin'), false) then return; end if;
  return query
    select 'cart'::text, c.id, p.business_name, u.full_name, c.invoice_number, c.invoice_date, c.invoice_due_date,
        c.invoice_total, c.invoice_rest, c.payment_checked_at
      from public.partner_carts c join public.partners p on p.id = c.partner_id left join public.app_users u on u.id = p.account_id
      where c.bocp_invoice_id is not null and (c.invoice_rest is null or c.invoice_rest > 0)
    union all
    select 'document'::text, d.id, coalesce(p.business_name, d.client_name), u.full_name, d.invoice_number, d.invoice_date, d.invoice_due_date,
        d.invoice_total, d.invoice_rest, d.payment_checked_at
      from public.sales_documents d left join public.partners p on p.id = d.partner_id left join public.app_users u on u.id = d.account_id
      where d.bocp_invoice_id is not null and (d.invoice_rest is null or d.invoice_rest > 0)
    order by 7 nulls last, 6;
end
$$;

-- Partner invoices now carry the due date and whether they are paid.
drop function public.partner_invoices(uuid);
drop function private.partner_invoices(uuid);
create function private.partner_invoices(p_partner_id uuid)
returns table(source text, id uuid, invoice_number text, invoice_date date, bocp_invoice_id text, invoice_pdf_url text,
  invoiced_at timestamptz, due_date date, rest numeric)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not (exists (select 1 from public.partners p where p.id = p_partner_id and p.auth_user_id = (select auth.uid()) and p.active)
      or private.can_manage_partner(p_partner_id)) then
    return;
  end if;
  return query
    select 'cart'::text, c.id, c.invoice_number, c.invoice_date, c.bocp_invoice_id, c.invoice_pdf_url, c.invoiced_at, c.invoice_due_date, c.invoice_rest
      from public.partner_carts c where c.partner_id = p_partner_id and c.invoiced_at is not null and c.bocp_invoice_id is not null
    union all
    select 'document'::text, d.id, d.invoice_number, d.invoice_date, d.bocp_invoice_id, d.invoice_pdf_url, d.invoiced_at, d.invoice_due_date, d.invoice_rest
      from public.sales_documents d where d.partner_id = p_partner_id and d.invoiced_at is not null and d.bocp_invoice_id is not null
    order by 7 desc
    limit 200;
end
$$;
create function public.partner_invoices(p_partner_id uuid)
returns table(source text, id uuid, invoice_number text, invoice_date date, bocp_invoice_id text, invoice_pdf_url text,
  invoiced_at timestamptz, due_date date, rest numeric)
language sql stable security invoker set search_path = '' as $$ select * from private.partner_invoices(p_partner_id) $$;

create function public.invoices_to_check(p_limit integer) returns table(source text, id uuid, bocp_invoice_id text)
language sql stable security invoker set search_path = '' as $$ select * from private.invoices_to_check(p_limit) $$;
create function public.record_invoice_payment(p_source text, p_id uuid, p_due_date date, p_total numeric, p_rest numeric, p_last_payment date) returns boolean
language sql security invoker set search_path = '' as $$ select private.record_invoice_payment(p_source, p_id, p_due_date, p_total, p_rest, p_last_payment) $$;
create function public.b2b_receivables()
returns table(source text, id uuid, partner_name text, agent_name text, invoice_number text, invoice_date date,
  due_date date, total numeric, rest numeric, payment_checked_at timestamptz)
language sql stable security invoker set search_path = '' as $$ select * from private.b2b_receivables() $$;

-- The scheduled payment check runs with the service role (server-only key).
grant usage on schema private to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'private.can_track_payments()', 'private.invoices_to_check(integer)',
    'private.record_invoice_payment(text, uuid, date, numeric, numeric, date)', 'private.b2b_receivables()',
    'private.partner_invoices(uuid)', 'public.partner_invoices(uuid)', 'public.invoices_to_check(integer)',
    'public.record_invoice_payment(text, uuid, date, numeric, numeric, date)', 'public.b2b_receivables()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
