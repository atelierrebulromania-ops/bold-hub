-- The owner's view of the team: per warehouse operator and per sales agent, over a period, plus the
-- clients that went quiet and the overdue invoices (read-only, owner and admin).
create function private.team_activity(p_from timestamptz, p_to timestamptz, p_inactive_days integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_inactive_days, 30), 1), 365);
begin
  if (select auth.uid()) is null or coalesce((select private.current_role()) not in ('admin', 'owner'), true) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '370 days' then
    raise exception 'Invalid range' using errcode = '22023';
  end if;

  return jsonb_build_object(
    -- Warehouse: online orders prepared (handed to the courier) and their preparation time, B2B carts
    -- put on the shelf and handed to billing, returns checked (and how many with remarks).
    'warehouse', coalesce((
      select jsonb_agg(row_to_json(w) order by w.online_prepared desc, w.name) from (
        select u.full_name as name,
          (select count(*) from public.online_orders o where o.claimed_by = u.id and o.completed_at >= p_from and o.completed_at < p_to
            and o.status in ('handed_to_courier', 'returned')) as online_prepared,
          (select round(avg(extract(epoch from o.completed_at - o.claimed_at)) / 60) from public.online_orders o
            where o.claimed_by = u.id and o.completed_at >= p_from and o.completed_at < p_to and o.claimed_at is not null
              and o.status in ('handed_to_courier', 'returned')) as avg_prep_minutes,
          (select count(*) from public.partner_carts c where c.prepared_by = u.id and c.prepared_at >= p_from and c.prepared_at < p_to) as b2b_shelved,
          (select count(*) from public.partner_carts c where c.delivered_by = u.id and c.delivered_at >= p_from and c.delivered_at < p_to) as b2b_handed,
          (select count(*) from public.order_returns r where r.restocked_by = u.id and r.restocked_at >= p_from and r.restocked_at < p_to) as returns_checked,
          (select count(*) from public.order_returns r where r.restocked_by = u.id and r.restocked_at >= p_from and r.restocked_at < p_to
            and r.restocked_with_remarks) as returns_with_remarks
        from public.app_users u
        where u.role in ('operator_depozit', 'admin')
      ) w
      where w.online_prepared + w.b2b_shelved + w.b2b_handed + w.returns_checked > 0), '[]'::jsonb),

    -- Sales agents: new clients, offers issued and what became of them, invoiced value in the period,
    -- and what their clients still owe (now).
    'agents', coalesce((
      select jsonb_agg(row_to_json(a) order by a.invoiced_value desc nulls last, a.name) from (
        select u.full_name as name,
          (select count(*) from public.partners p where p.account_id = u.id and p.created_at >= p_from and p.created_at < p_to) as new_clients,
          (select count(*) from public.sales_documents d where d.account_id = u.id and d.kind = 'offer'
            and d.issued_at >= p_from and d.issued_at < p_to) as offers,
          (select count(*) from public.sales_documents d where d.account_id = u.id and d.kind = 'offer'
            and d.issued_at >= p_from and d.issued_at < p_to
            and exists (select 1 from public.sales_documents x where x.source_document_id = d.id and x.status in ('issued', 'cancel_requested', 'cancelled'))) as offers_to_proforma,
          (select count(*) from public.sales_documents d where d.account_id = u.id and d.kind = 'offer'
            and d.issued_at >= p_from and d.issued_at < p_to
            and exists (select 1 from public.sales_documents x left join public.partner_carts c on c.id = x.cart_id
              where x.source_document_id = d.id and (x.invoiced_at is not null or c.invoiced_at is not null))) as offers_invoiced,
          (select count(*) from public.sales_documents d where d.account_id = u.id and d.kind = 'proforma'
            and d.issued_at >= p_from and d.issued_at < p_to) as proformas,
          (select coalesce(sum(c.invoice_total), 0) from public.partner_carts c join public.partners p on p.id = c.partner_id
            where p.account_id = u.id and c.invoiced_at >= p_from and c.invoiced_at < p_to)
            + (select coalesce(sum(d.invoice_total), 0) from public.sales_documents d
            where d.account_id = u.id and d.invoiced_at >= p_from and d.invoiced_at < p_to) as invoiced_value,
          (select count(*) from public.partner_carts c join public.partners p on p.id = c.partner_id
            where p.account_id = u.id and c.invoiced_at >= p_from and c.invoiced_at < p_to)
            + (select count(*) from public.sales_documents d where d.account_id = u.id and d.invoiced_at >= p_from and d.invoiced_at < p_to) as invoices,
          (select coalesce(sum(c.invoice_rest), 0) from public.partner_carts c join public.partners p on p.id = c.partner_id
            where p.account_id = u.id and c.invoice_rest > 0)
            + (select coalesce(sum(d.invoice_rest), 0) from public.sales_documents d where d.account_id = u.id and d.invoice_rest > 0) as outstanding,
          (select coalesce(sum(c.invoice_rest), 0) from public.partner_carts c join public.partners p on p.id = c.partner_id
            where p.account_id = u.id and c.invoice_rest > 0 and c.invoice_due_date < (now() at time zone 'Europe/Bucharest')::date)
            + (select coalesce(sum(d.invoice_rest), 0) from public.sales_documents d where d.account_id = u.id and d.invoice_rest > 0
            and d.invoice_due_date < (now() at time zone 'Europe/Bucharest')::date) as overdue
        from public.app_users u
        where u.role = 'account' and u.active
      ) a), '[]'::jsonb),

    -- Clients with no request for a while (or never), per agent: time to call them.
    'inactive_days', v_days,
    'inactive_clients', coalesce((
      select jsonb_agg(row_to_json(i) order by i.agent nulls last, i.last_request nulls first) from (
        select p.business_name as name, p.location_name as location, u.full_name as agent,
          (select max(r.created_at) from public.refill_requests r where r.partner_id = p.id) as last_request
        from public.partners p left join public.app_users u on u.id = p.account_id
        where p.active
          and not exists (select 1 from public.refill_requests r where r.partner_id = p.id and r.created_at >= now() - make_interval(days => v_days))
      ) i), '[]'::jsonb),

    -- Overdue B2B invoices right now (details on the receivables page).
    'overdue', (
      select jsonb_build_object('count', count(*), 'amount', coalesce(sum(rest), 0)) from (
        select c.invoice_rest as rest from public.partner_carts c
          where c.invoice_rest > 0 and c.invoice_due_date < (now() at time zone 'Europe/Bucharest')::date
        union all
        select d.invoice_rest from public.sales_documents d
          where d.invoice_rest > 0 and d.invoice_due_date < (now() at time zone 'Europe/Bucharest')::date
      ) x)
  );
end
$$;

create function public.team_activity(p_from timestamptz, p_to timestamptz, p_inactive_days integer) returns jsonb
language sql stable security invoker set search_path = '' as $$ select private.team_activity(p_from, p_to, p_inactive_days) $$;

revoke all on function private.team_activity(timestamptz, timestamptz, integer) from public, anon;
grant execute on function private.team_activity(timestamptz, timestamptz, integer) to authenticated;
revoke all on function public.team_activity(timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.team_activity(timestamptz, timestamptz, integer) to authenticated;
