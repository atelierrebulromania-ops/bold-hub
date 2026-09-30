-- The owner's client list: every B2B client with its type, agent, delivery groups and what it ordered
-- (invoiced value, from the warehouse flow and proformas invoiced directly) in a period, or ever.
create function private.owner_clients(p_from timestamptz, p_to timestamptz)
returns table(id uuid, name text, location text, type text, active boolean, agent text, delivery_groups text[],
  orders bigint, units bigint, invoiced_value numeric, outstanding numeric, last_order timestamptz)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_from timestamptz := coalesce(p_from, '-infinity'::timestamptz);
  v_to timestamptz := coalesce(p_to, 'infinity'::timestamptz);
begin
  if (select auth.uid()) is null or coalesce((select private.current_role()) not in ('admin', 'owner'), true) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  return query
    select p.id, p.business_name, p.location_name, p.type, p.active, u.full_name,
      coalesce((select array_agg(g.name order by g.name) from public.partner_delivery_groups pg
        join public.delivery_groups g on g.id = pg.delivery_group_id where pg.partner_id = p.id), '{}'),
      (select count(*) from public.partner_carts c where c.partner_id = p.id and c.status <> 'open'
        and c.prepared_at >= v_from and c.prepared_at < v_to),
      (select coalesce(sum(i.quantity_needed), 0)::bigint from public.partner_cart_items i join public.partner_carts c on c.id = i.cart_id
        where c.partner_id = p.id and c.status <> 'open' and c.prepared_at >= v_from and c.prepared_at < v_to),
      (select coalesce(sum(c.invoice_total), 0) from public.partner_carts c where c.partner_id = p.id and c.invoiced_at >= v_from and c.invoiced_at < v_to)
        + (select coalesce(sum(d.invoice_total), 0) from public.sales_documents d where d.partner_id = p.id and d.invoiced_at >= v_from and d.invoiced_at < v_to),
      (select coalesce(sum(c.invoice_rest), 0) from public.partner_carts c where c.partner_id = p.id and c.invoice_rest > 0)
        + (select coalesce(sum(d.invoice_rest), 0) from public.sales_documents d where d.partner_id = p.id and d.invoice_rest > 0),
      (select max(c.created_at) from public.partner_carts c where c.partner_id = p.id)
    from public.partners p left join public.app_users u on u.id = p.account_id
    order by p.business_name;
end
$$;

create function public.owner_clients(p_from timestamptz, p_to timestamptz)
returns table(id uuid, name text, location text, type text, active boolean, agent text, delivery_groups text[],
  orders bigint, units bigint, invoiced_value numeric, outstanding numeric, last_order timestamptz)
language sql stable security invoker set search_path = '' as $$ select * from private.owner_clients(p_from, p_to) $$;

revoke all on function private.owner_clients(timestamptz, timestamptz) from public, anon;
grant execute on function private.owner_clients(timestamptz, timestamptz) to authenticated;
revoke all on function public.owner_clients(timestamptz, timestamptz) from public, anon;
grant execute on function public.owner_clients(timestamptz, timestamptz) to authenticated;
