-- Point logins: besides the client's manager login (partners.auth_user_id), a point of work can have its own
-- login (partner_locations.auth_user_id). A point login sees only its point (stock, requests, orders,
-- backorders) and no invoices. It works only while the client orders per point of work.
alter table public.partner_locations
  add column auth_user_id uuid unique references auth.users(id) on delete set null,
  add column account_username text;

-- The partner (client) of the signed-in partner user: its manager login or one of its point logins.
CREATE FUNCTION private.my_partner_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select p.id from public.partners p where p.auth_user_id = (select auth.uid()) and p.active),
    (select l.partner_id from public.partner_locations l join public.partners p on p.id = l.partner_id
      where l.auth_user_id = (select auth.uid()) and l.active and p.active and p.stock_mode = 'per_location'))
$function$;

-- The point of a point login (null for the manager login and for staff).
CREATE FUNCTION private.my_point_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select l.id from public.partner_locations l join public.partners p on p.id = l.partner_id
    where l.auth_user_id = (select auth.uid()) and l.active and p.active and p.stock_mode = 'per_location'
$function$;
revoke all on function private.my_partner_id() from public, anon;
revoke all on function private.my_point_id() from public, anon;
grant execute on function private.my_partner_id() to authenticated;
grant execute on function private.my_point_id() to authenticated;

-- Partner read policies: the manager sees the whole client, a point login only its point.
drop policy own_partner on public.partners;
create policy own_partner on public.partners for select to authenticated
  using (id = (select private.my_partner_id()) and active);

drop policy partner_own on public.partner_locations;
create policy partner_own on public.partner_locations for select to authenticated
  using (partner_id = (select private.my_partner_id()) and ((select private.my_point_id()) is null or id = (select private.my_point_id())));

drop policy own_par_levels on public.partner_par_levels;
create policy own_par_levels on public.partner_par_levels for select to authenticated
  using (partner_id = (select private.my_partner_id()) and ((select private.my_point_id()) is null or location_id = (select private.my_point_id())));

drop policy own_carts on public.partner_carts;
create policy own_carts on public.partner_carts for select to authenticated
  using (partner_id = (select private.my_partner_id()) and ((select private.my_point_id()) is null or location_id = (select private.my_point_id())));

drop policy own_cart_items on public.partner_cart_items;
create policy own_cart_items on public.partner_cart_items for select to authenticated
  using (exists (select 1 from public.partner_carts c where c.id = partner_cart_items.cart_id
    and c.partner_id = (select private.my_partner_id()) and ((select private.my_point_id()) is null or c.location_id = (select private.my_point_id()))));

drop policy partner_own on public.partner_backorders;
create policy partner_own on public.partner_backorders for select to authenticated
  using (partner_id = (select private.my_partner_id()) and ((select private.my_point_id()) is null or location_id = (select private.my_point_id())));

drop policy own_refill_requests on public.refill_requests;
create policy own_refill_requests on public.refill_requests for select to authenticated
  using (partner_id = (select private.my_partner_id()) and (select private.my_point_id()) is null);

drop policy catalog_read on public.products;
create policy catalog_read on public.products for select to authenticated
  using ((select private.current_role()) = any (array['operator_depozit'::public.user_role, 'operator_facturare'::public.user_role])
    or (active = true and (select private.my_partner_id()) is not null));

-- A point login sees the partner's news about its own point's orders (and general news).
CREATE FUNCTION private.partner_notification_visible(p_partner_id uuid, p_entity_type text, p_entity_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_partner_id is not null and p_partner_id = (select private.my_partner_id())
    and ((select private.my_point_id()) is null
      or p_entity_type is distinct from 'partner_cart'
      or exists (select 1 from public.partner_carts c where c.id = p_entity_id and c.location_id = (select private.my_point_id())))
$function$;
revoke all on function private.partner_notification_visible(uuid, text, uuid) from public, anon;
grant execute on function private.partner_notification_visible(uuid, text, uuid) to authenticated;

drop policy own_notifications on public.notifications;
create policy own_notifications on public.notifications for select to authenticated
  using (recipient_user_id = (select auth.uid())
    or (recipient_role is not null and recipient_role = (select private.current_role()))
    or private.partner_notification_visible(recipient_partner_id, related_entity_type, related_entity_id));

CREATE OR REPLACE FUNCTION private.mark_notifications_read(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_count integer;
begin
  if (select auth.uid()) is null then return 0; end if;
  update public.notifications n set read_at = now()
    where n.read_at is null and (p_ids is null or n.id = any(p_ids))
      and (n.recipient_user_id = (select auth.uid())
        or (n.recipient_role is not null and n.recipient_role = (select private.current_role()))
        or private.partner_notification_visible(n.recipient_partner_id, n.related_entity_type, n.related_entity_id));
  get diagnostics v_count = row_count;
  return v_count;
end
$function$;

-- A point login always counts and orders for its own point.
CREATE OR REPLACE FUNCTION private.submit_refill_counts(p_counts jsonb, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_partner_id uuid := private.my_partner_id();
begin
  if v_partner_id is null then raise exception 'Access denied' using errcode = '42501'; end if;
  return private.refill_counts_for(v_partner_id, p_counts, coalesce(private.my_point_id(), p_location_id));
end
$function$;

CREATE OR REPLACE FUNCTION private.remove_cart_item(p_item_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_item record;
begin
  select i.id, i.product_id, i.quantity_needed, i.refill_request_id, c.partner_id, c.location_id, c.id as cart_id
    into v_item
    from public.partner_cart_items i join public.partner_carts c on c.id = i.cart_id
    where i.id = p_item_id and c.status = 'open' for update of i, c;
  if not found then return false; end if;
  if not (private.is_staff(array['admin', 'operator_depozit']::public.user_role[])
    or (v_item.partner_id = private.my_partner_id()
      and (private.my_point_id() is null or v_item.location_id = private.my_point_id()))) then
    return false;
  end if;

  update public.refill_requests set cart_item_id = null, status = 'rejected' where id = v_item.refill_request_id;
  delete from public.partner_cart_items where id = p_item_id;
  update public.warehouse_stock
    set quantity_reserved = greatest(0, quantity_reserved - v_item.quantity_needed), updated_at = now()
    where product_id = v_item.product_id;
  -- An emptied cart stops its 48h countdown.
  update public.partner_carts set countdown_started_at = null
    where id = v_item.cart_id and not exists (select 1 from public.partner_cart_items where cart_id = v_item.cart_id);
  return true;
end
$function$;

-- Invoices are per CUI: the manager login sees them, a point login does not.
CREATE OR REPLACE FUNCTION private.partner_invoices(p_partner_id uuid)
 RETURNS TABLE(source text, id uuid, invoice_number text, invoice_date date, bocp_invoice_id text, invoice_pdf_url text, invoiced_at timestamp with time zone, due_date date, rest numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not ((p_partner_id = private.my_partner_id() and private.my_point_id() is null)
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
$function$;
