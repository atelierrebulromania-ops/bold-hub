-- Partner self-service: the client follows its orders live and sees its invoices; its agent hears
-- about its requests.

-- A request for a client also notifies the client's agent (unless the agent made it).
create or replace function private.cart_add_items(p_partner_id uuid, p_items jsonb, p_source text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_partner public.partners%rowtype;
  v_cart_id uuid;
  v_item jsonb;
  v_product uuid;
  v_quantity integer;
  v_request_id uuid;
  v_cart_item_id uuid;
  v_added integer := 0;
  v_units integer := 0;
begin
  select * into v_partner from public.partners where id = p_partner_id and active for update;
  if not found then raise exception 'Partner not found' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0
    or jsonb_array_length(p_items) > 200 then
    raise exception 'Invalid items' using errcode = '22023';
  end if;

  select id into v_cart_id from public.partner_carts where partner_id = p_partner_id and status = 'open';
  if v_cart_id is null then
    insert into public.partner_carts (partner_id) values (p_partner_id) returning id into v_cart_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity is null or v_quantity < 1 or v_quantity > 100000 then
      raise exception 'Invalid quantity' using errcode = '22023';
    end if;
    perform 1 from public.products where id = v_product and active;
    if not found then raise exception 'Unknown product' using errcode = '22023'; end if;

    insert into public.refill_requests (partner_id, source, phone_number, quantity, status, confirmed_at)
      values (p_partner_id, p_source, case when p_source = 'whatsapp' then v_partner.contact_phone end,
        v_quantity, 'confirmed', now())
      returning id into v_request_id;
    insert into public.partner_cart_items (cart_id, product_id, quantity_needed, refill_request_id)
      values (v_cart_id, v_product, v_quantity, v_request_id) returning id into v_cart_item_id;
    update public.refill_requests set cart_item_id = v_cart_item_id where id = v_request_id;
    insert into public.warehouse_stock (product_id, quantity_reserved) values (v_product, v_quantity)
      on conflict (product_id) do update
      set quantity_reserved = public.warehouse_stock.quantity_reserved + excluded.quantity_reserved, updated_at = now();
    v_added := v_added + 1;
    v_units := v_units + v_quantity;
  end loop;

  update public.partner_carts set countdown_started_at = coalesce(countdown_started_at, now()) where id = v_cart_id;
  if v_partner.is_important_client then
    perform private.notify('operator_depozit', 'client_prioritar',
      'Client prioritar: ' || v_partner.business_name || ' — livrare imediată, ' || v_units || ' buc. de pregătit.',
      'partner_cart', v_cart_id);
  else
    perform private.notify('operator_depozit', 'refill_nou',
      'Refill nou: ' || v_partner.business_name || ' — ' || v_units || ' buc. de pus pe raftul rezervat.',
      'partner_cart', v_cart_id);
  end if;
  if v_partner.account_id is not null and v_partner.account_id is distinct from (select auth.uid()) then
    insert into public.notifications (recipient_user_id, type, message, related_entity_type, related_entity_id)
      values (v_partner.account_id, 'cerere_client',
        'Cerere nouă de la ' || v_partner.business_name || case when p_source = 'app' then ' (din aplicație)' else '' end
          || ': ' || v_units || ' buc. Depozitul o pregătește.',
        'partner_cart', v_cart_id);
  end if;

  return jsonb_build_object('cart_id', v_cart_id, 'items', v_added, 'units', v_units);
end
$$;

-- The client is told when its order is on the shelf, delivered and invoiced.
create function private.notify_partner_of_cart_progress()
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
  elsif new.invoiced_at is not null and old.invoiced_at is null then
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
revoke all on function private.notify_partner_of_cart_progress() from public, anon, authenticated;

create trigger partner_cart_progress_notifications
  after update of status, invoiced_at on public.partner_carts
  for each row execute function private.notify_partner_of_cart_progress();

-- Invoices of a location: its B2B carts and the proformas its agent had invoiced directly. The
-- partner reads its own; staff who manage the partner (admin, its agent) read them too.
create function private.partner_invoices(p_partner_id uuid)
returns table(source text, id uuid, invoice_number text, invoice_date date, bocp_invoice_id text, invoice_pdf_url text, invoiced_at timestamptz)
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
    select 'cart'::text, c.id, c.invoice_number, c.invoice_date, c.bocp_invoice_id, c.invoice_pdf_url, c.invoiced_at
      from public.partner_carts c where c.partner_id = p_partner_id and c.invoiced_at is not null and c.bocp_invoice_id is not null
    union all
    select 'document'::text, d.id, d.invoice_number, d.invoice_date, d.bocp_invoice_id, d.invoice_pdf_url, d.invoiced_at
      from public.sales_documents d where d.partner_id = p_partner_id and d.invoiced_at is not null and d.bocp_invoice_id is not null
    order by 7 desc
    limit 200;
end
$$;

create function public.partner_invoices(p_partner_id uuid)
returns table(source text, id uuid, invoice_number text, invoice_date date, bocp_invoice_id text, invoice_pdf_url text, invoiced_at timestamptz)
language sql stable security invoker set search_path = '' as $$ select * from private.partner_invoices(p_partner_id) $$;

revoke all on function private.partner_invoices(uuid) from public, anon;
grant execute on function private.partner_invoices(uuid) to authenticated;
revoke all on function public.partner_invoices(uuid) from public, anon;
grant execute on function public.partner_invoices(uuid) to authenticated;
