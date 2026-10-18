-- One invoice for several delivered carts of the same partner. The invoice (BOCP id, totals, due date,
-- payments) lives on the first cart; the others point to it (invoiced_with), so every total counts it once.
alter table public.partner_carts add column invoiced_with uuid references public.partner_carts(id) on delete set null;

create or replace function private.mark_partner_carts_invoiced(p_cart_ids uuid[], p_invoice_number text, p_bocp_invoice_id text, p_invoice_date date, p_invoice_pdf_url text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_number text := nullif(btrim(p_invoice_number), '');
  v_primary uuid;
  v_partner record;
  v_count integer;
begin
  if (select auth.uid()) is null or not coalesce((select private.current_role()) in ('admin', 'operator_facturare'), false) then
    raise exception 'Billing access required' using errcode = '42501';
  end if;
  if v_number is null or char_length(v_number) > 60 or p_bocp_invoice_id !~ '^[1-9][0-9]{0,18}$' or p_invoice_date is null
    or (p_invoice_pdf_url is not null and p_invoice_pdf_url !~ '^https://secure\.bocp\.eu/')
    or coalesce(array_length(p_cart_ids, 1), 0) not between 1 and 20 then
    return null;
  end if;
  -- All carts: delivered, not invoiced yet, one partner.
  select count(*) into v_count
    from public.partner_carts where id = any(p_cart_ids) and status = 'delivered' and invoiced_at is null;
  if v_count <> array_length(p_cart_ids, 1) or not (select count(distinct partner_id) = 1 from public.partner_carts where id = any(p_cart_ids)) then
    return null;
  end if;
  select id into v_primary from public.partner_carts where id = any(p_cart_ids) order by delivered_at, id limit 1 for update;

  update public.partner_carts set invoiced_at = now(), invoiced_by = (select auth.uid()), invoice_number = v_number,
      bocp_invoice_id = p_bocp_invoice_id, invoice_date = p_invoice_date, invoice_pdf_url = p_invoice_pdf_url
    where id = v_primary;
  update public.partner_carts set invoiced_at = now(), invoiced_by = (select auth.uid()), invoice_number = v_number,
      invoice_date = p_invoice_date, invoiced_with = v_primary
    where id = any(p_cart_ids) and id <> v_primary;

  select p.business_name, p.account_id into v_partner
    from public.partner_carts c join public.partners p on p.id = c.partner_id where c.id = v_primary;
  if v_partner.account_id is not null then
    insert into public.notifications (recipient_user_id, type, message, related_entity_type, related_entity_id)
      values (v_partner.account_id, 'client_facturat', 'Comanda pentru ' || v_partner.business_name || ' a fost facturată (' || v_number || ')'
        || case when array_length(p_cart_ids, 1) > 1 then ' — ' || array_length(p_cart_ids, 1) || ' comenzi într-o factură.' else '.' end,
        'partner_cart', v_primary);
  end if;
  return v_primary;
end
$$;

-- The partner hears about the invoice once (on the cart that carries it).
create or replace function private.notify_partner_of_cart_progress()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_message text;
  v_type text;
begin
  if new.status = 'prepared' and old.status is distinct from 'prepared' then
    v_type := 'comanda_pregatita';
    v_message := 'Comanda ta este pregătită în depozit și urmează să fie livrată.';
  elsif new.status = 'delivered' and old.status is distinct from 'delivered' then
    v_type := 'comanda_livrata';
    v_message := 'Comanda ta a fost livrată.';
  elsif new.invoiced_at is not null and old.invoiced_at is null and new.invoiced_with is null then
    v_type := 'factura_disponibila';
    v_message := 'Factura ' || coalesce(new.invoice_number, '') || ' pentru comanda ta este disponibilă în aplicație.';
  else
    return new;
  end if;
  insert into public.notifications (recipient_partner_id, type, message, related_entity_type, related_entity_id)
    values (new.partner_id, v_type, v_message, 'partner_cart', new.id);
  return new;
end
$$;

-- Counts of invoices: carts invoiced together are one invoice.
do $$
declare v_fn text; v_def text; v_before text;
begin
  foreach v_fn in array array['dashboard_summary', 'team_activity'] loop
    select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname = v_fn;
    v_before := v_def;
    v_def := replace(v_def, $x$where invoiced_at >= p_from and invoiced_at < p_to)$x$, $x$where invoiced_at >= p_from and invoiced_at < p_to and invoiced_with is null)$x$);
    v_def := replace(v_def, $x$where p.account_id = u.id and c.invoiced_at >= p_from and c.invoiced_at < p_to)
            + (select count(*)$x$, $x$where p.account_id = u.id and c.invoiced_at >= p_from and c.invoiced_at < p_to and c.invoiced_with is null)
            + (select count(*)$x$);
    if v_def = v_before then raise exception '% not patched', v_fn; end if;
    execute v_def;
  end loop;
end
$$;

create or replace function public.mark_partner_carts_invoiced(p_cart_ids uuid[], p_invoice_number text, p_bocp_invoice_id text, p_invoice_date date, p_invoice_pdf_url text)
returns uuid language sql security invoker set search_path to ''
as $$ select private.mark_partner_carts_invoiced(p_cart_ids, p_invoice_number, p_bocp_invoice_id, p_invoice_date, p_invoice_pdf_url) $$;
revoke all on function private.mark_partner_carts_invoiced(uuid[], text, text, date, text), public.mark_partner_carts_invoiced(uuid[], text, text, date, text) from public, anon;
grant execute on function private.mark_partner_carts_invoiced(uuid[], text, text, date, text), public.mark_partner_carts_invoiced(uuid[], text, text, date, text) to authenticated;
