-- End-to-end flow tests per account type, run against the real schema and RPCs.
-- Safe on the live project: everything happens in one transaction that always rolls back
-- (the final RAISE aborts it), so no test data is ever kept.
-- Run with the Supabase SQL editor or MCP execute_sql; the result is the error message:
--   "ROLE FLOWS: <passed>/<total> passed" followed by one line per failed check.
-- Needs one active app_user each for admin, owner, operator_depozit and operator_facturare.
-- Test EANs use the 299 prefix (in-store numbering), so they never collide with the real catalog.

create temp table t_results (seq serial, role text, label text, ok boolean);
grant insert, select on t_results to authenticated;
grant usage on sequence t_results_seq_seq to authenticated;

do $flows$
declare
  u_admin uuid := (select id from public.app_users where role = 'admin' and active order by created_at limit 1);
  u_owner uuid := (select id from public.app_users where role = 'owner' and active order by created_at limit 1);
  u_dep uuid := (select id from public.app_users where role = 'operator_depozit' and active order by created_at limit 1);
  u_fac uuid := (select id from public.app_users where role = 'operator_facturare' and active order by created_at limit 1);
  u_dep2 uuid := gen_random_uuid();
  u_res uuid := gen_random_uuid();
  g uuid; co uuid; r1 uuid; r2 uuid; r3 uuid;
  o1 uuid; o2 uuid; ret uuid; d_imp uuid; d_man uuid; ful uuid;
  v jsonb; v_text text; v_ok boolean;
  v_total integer; v_passed integer; v_failures text;
begin
  if u_admin is null or u_owner is null or u_dep is null or u_fac is null then
    raise exception 'ROLE FLOWS: missing one of the staff roles (admin, owner, operator_depozit, operator_facturare)';
  end if;

  -- Fixtures that exist only in this transaction: a second warehouse operator and a partner login.
  insert into auth.users (id, email, aud, role, instance_id) values
    (u_dep2, 'zz-flow-depozit2@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (u_res, 'zz-flow-partner@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  insert into public.app_users (id, full_name, role) values (u_dep2, 'ZZ Operator 2', 'operator_depozit');
  insert into public.partner_companies (company_name) values ('ZZ Flow SRL') returning id into co;
  insert into public.delivery_groups (name) values ('ZZ Traseu') returning id into g;
  insert into public.partners (company_id, business_name, location_name, contact_phone)
    values (co, 'ZZ Hotel', 'Centru', '+40700999001') returning id into r1;
  insert into public.partners (company_id, business_name, location_name, contact_phone, is_important_client)
    values (co, 'ZZ Restaurant', 'Nord', '+40700999002', true) returning id into r2;
  insert into public.partners (company_id, business_name, location_name, contact_phone)
    values (co, 'ZZ Magazin', 'Sud', '+40700999003') returning id into r3;
  insert into public.partner_delivery_groups values (r1, g), (r2, g);

  ---------------------------------------------------------------- ADMIN: setup
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v := public.import_bocp_online_orders(jsonb_build_array(
    jsonb_build_object('invoiceNumber', 'ZZFLOW-1', 'invoiceDate', '2026-09-20', 'bocpInvoiceId', 'zz-inv-1',
      'source', 'shopify', 'bocpOrderId', 'ZZ-SH-1', 'customerName', 'Ana Testescu', 'customerPhone', '+40 733 111 222',
      'customerEmail', 'ana@test.invalid', 'shippingAddress', 'Str. Test 1',
      'items', jsonb_build_array(
        jsonb_build_object('sku', 'ZZ-T-A', 'bocpProductId', '990001', 'name', 'Lotiune 250ml', 'ean', '2990000000011', 'quantity', '2'),
        jsonb_build_object('sku', 'ZZ-T-B', 'bocpProductId', '990002', 'name', 'Sapun 400ml', 'quantity', '1'))),
    jsonb_build_object('invoiceNumber', 'ZZFLOW-2', 'invoiceDate', '2026-09-20', 'bocpInvoiceId', 'zz-inv-2',
      'source', 'marketplace', 'customerName', 'Ion Test',
      'items', jsonb_build_array(jsonb_build_object('sku', 'ZZ-T-A', 'bocpProductId', '990001', 'name', 'Lotiune 250ml', 'quantity', '1')))));
  insert into t_results (role, label, ok) values ('admin', 'importă 2 comenzi BOCP', (v->>'inserted')::int = 2);
  v := public.import_bocp_online_orders(jsonb_build_array(jsonb_build_object('invoiceNumber', 'ZZFLOW-1', 'invoiceDate', '2026-09-20',
    'bocpInvoiceId', 'zz-inv-1', 'source', 'shopify', 'items', jsonb_build_array(jsonb_build_object('sku', 'ZZ-T-A', 'bocpProductId', '990001', 'quantity', '2')))));
  insert into t_results (role, label, ok) values ('admin', 'reimportul nu dublează', (v->>'alreadyPresent')::int = 1 and (v->>'inserted')::int = 0);
  insert into t_results (role, label, ok) values ('admin', 'EAN-ul din factură ajunge pe produs',
    (select ean from public.products where sku = 'ZZ-T-A') = '2990000000011');
  v := public.sync_bocp_catalog('[{"sku":"ZZ-T-C","name":"Difuzor","ean":"2990000000028","stock":20},{"sku":"ZZ-T-A","name":"Lotiune 250ml","stock":50}]'::jsonb);
  insert into t_results (role, label, ok) values ('admin', 'sincronizare catalog BOCP', (v->>'created')::int = 1 and (v->>'stockSet')::int = 2);
  insert into t_results (role, label, ok) values ('admin', 'asociază contul revânzătorului', public.link_partner_account(r1, 'zz-flow-partner@test.invalid') = 'linked');
  insert into public.partner_par_levels (partner_id, product_id, par_level_quantity, set_by)
    select r1, id, case sku when 'ZZ-T-A' then 10 else 4 end, u_admin from public.products where sku in ('ZZ-T-A', 'ZZ-T-B');
  insert into t_results (role, label, ok) values ('admin', 'setează stoc inițial (par level)', (select count(*) from public.partner_par_levels where partner_id = r1) = 2);
  insert into t_results (role, label, ok) values ('admin', 'trece produsul pe scanare EAN',
    public.set_product_scan_mode((select id from public.products where sku = 'ZZ-T-A'), 'ean') = 'saved');
  insert into t_results (role, label, ok) values ('admin', 'comenzile nepreluate primesc codul EAN',
    not exists (select 1 from public.online_order_items i join public.products p on p.id = i.product_id
      where p.sku = 'ZZ-T-A' and (i.scan_code_type <> 'ean' or i.scan_code <> '2990000000011')));
  reset role;
  select id into o1 from public.online_orders where invoice_number = 'ZZFLOW-1';
  select id into o2 from public.online_orders where invoice_number = 'ZZFLOW-2';

  ---------------------------------------------------------------- DEPOZIT: online orders
  perform set_config('request.jwt.claims', json_build_object('sub', u_dep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into t_results (role, label, ok) values ('depozit', 'vede comenzile noi pe board',
    (select count(*) from public.online_orders where invoice_number like 'ZZFLOW-%' and status = 'pending') = 2);
  insert into t_results (role, label, ok) values ('depozit', 'preia comanda 1', public.claim_online_order(o1));
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_dep2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into t_results (role, label, ok) values ('depozit', 'al doilea operator NU poate prelua aceeași comandă', not public.claim_online_order(o1));
  insert into t_results (role, label, ok) values ('depozit', 'al doilea operator preia comanda 2', public.claim_online_order(o2));
  insert into t_results (role, label, ok) values ('depozit', 'nu poate scana în comanda altuia', not public.scan_online_order_code(o1, '2990000000011'));
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_dep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into t_results (role, label, ok) values ('depozit', 'SKU respins când produsul e pe EAN', not public.scan_online_order_code(o1, 'ZZ-T-A'));
  insert into t_results (role, label, ok) values ('depozit', 'scanare EAN 1/2', public.scan_online_order_code(o1, '2990000000011'));
  insert into t_results (role, label, ok) values ('depozit', 'nu poate marca gata cu produse lipsă', not public.mark_online_order_ready(o1));
  insert into t_results (role, label, ok) values ('depozit', 'scanare EAN 2/2', public.scan_online_order_code(o1, '2990000000011'));
  insert into t_results (role, label, ok) values ('depozit', 'a treia scanare peste cantitate respinsă', not public.scan_online_order_code(o1, '2990000000011'));
  insert into t_results (role, label, ok) values ('depozit', 'cod greșit respins (roșu)', not public.scan_online_order_code(o1, '0000000000000'));
  insert into t_results (role, label, ok) values ('depozit', 'confirmare SKU pentru produsul fără EAN', public.scan_online_order_code(o1, 'zz-t-b'));
  insert into t_results (role, label, ok) values ('depozit', 'nu poate preda înainte de „gata”', not public.hand_online_order_to_courier(o1));
  insert into t_results (role, label, ok) values ('depozit', 'marchează comanda gata', public.mark_online_order_ready(o1));
  insert into t_results (role, label, ok) values ('depozit', 'predă curierului', public.hand_online_order_to_courier(o1));
  insert into t_results (role, label, ok) values ('depozit', 'nu poate marca gata comanda altuia', not public.mark_online_order_ready(o2));
  insert into t_results (role, label, ok) values ('depozit', 'NU poate modifica EAN-uri (doar admin)',
    public.set_product_ean((select id from public.products where sku = 'ZZ-T-B'), '2990000000028') = 'denied');
  begin perform public.sync_bocp_catalog('[]'::jsonb); v_ok := false; exception when insufficient_privilege then v_ok := true; end;
  insert into t_results (role, label, ok) values ('depozit', 'NU poate sincroniza catalogul', v_ok);
  begin perform public.dashboard_summary(now() - interval '1 day', now()); v_ok := false; exception when insufficient_privilege then v_ok := true; end;
  insert into t_results (role, label, ok) values ('depozit', 'NU vede dashboard-ul owner', v_ok);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_dep2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.scan_online_order_code(o2, '2990000000011');
  insert into t_results (role, label, ok) values ('depozit', 'renunță la comandă (revine pe board)', public.release_online_order(o2));
  reset role;
  insert into t_results (role, label, ok) values ('depozit', 'eliberarea resetează scanările',
    (select status from public.online_orders where id = o2) = 'pending'
    and (select sum(scanned_quantity) from public.online_order_items where order_id = o2) = 0);

  ---------------------------------------------------------------- FACTURARE: returns
  perform set_config('request.jwt.claims', json_build_object('sub', u_fac, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v := public.search_online_orders('0733111222');
  insert into t_results (role, label, ok) values ('facturare', 'caută comanda după telefon', jsonb_array_length(v) = 1);
  insert into t_results (role, label, ok) values ('facturare', 'vede cine a pregătit comanda', v->0->>'claimed_by_name' is not null);
  insert into t_results (role, label, ok) values ('facturare', 'NU poate prelua comenzi', not public.claim_online_order(o2));
  insert into t_results (role, label, ok) values ('facturare', 'NU poate face retur la comandă nepredată', not public.register_order_return(o2, 'neridicat', false));
  insert into t_results (role, label, ok) values ('facturare', 'înregistrează retur', public.register_order_return(o1, 'refuzat_livrare', false));
  insert into t_results (role, label, ok) values ('facturare', 'NU poate înregistra returul de două ori', not public.register_order_return(o1, 'neridicat', false));
  select id into ret from public.order_returns where online_order_id = o1;
  insert into t_results (role, label, ok) values ('facturare', 'NU poate marca returul în Shopify (doar admin)', not public.mark_return_in_shopify(ret));
  insert into t_results (role, label, ok) values ('facturare', 'NU poate confirma verificarea fizică', not public.confirm_return_restock(ret));
  begin insert into public.order_returns (online_order_id, registered_by) values (o2, u_fac); v_ok := false;
  exception when insufficient_privilege then v_ok := true; end;
  insert into t_results (role, label, ok) values ('facturare', 'NU poate ocoli regulile scriind direct în tabel', v_ok);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', u_dep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into t_results (role, label, ok) values ('depozit', 'primește notificarea de retur de verificat',
    exists (select 1 from public.notifications where type = 'retur_de_verificat' and related_entity_id = ret));
  insert into t_results (role, label, ok) values ('depozit', 'procesează returul cu mențiuni', public.confirm_return_restock(ret, '  lipsește un produs  ', true));
  insert into t_results (role, label, ok) values ('depozit', 'nu poate procesa returul de două ori', not public.confirm_return_restock(ret));
  reset role;
  insert into t_results (role, label, ok) values ('facturare', 'primește nota returului procesat cu mențiuni',
    (select restock_note = 'lipsește un produs' and restocked_with_remarks from public.order_returns where id = ret)
    and exists (select 1 from public.notifications where type = 'retur_cu_mentiuni' and recipient_role = 'operator_facturare'
      and related_entity_id = ret and message like '%ZZFLOW-1 — lipsește un produs'));

  ---------------------------------------------------------------- REVÂNZĂTOR: refill from the app
  perform set_config('request.jwt.claims', json_build_object('sub', u_res, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into t_results (role, label, ok) values ('revânzător', 'vede doar propria locație', (select count(*) from public.partners) = 1);
  insert into t_results (role, label, ok) values ('revânzător', 'NU vede comenzile online', (select count(*) from public.online_orders) = 0);
  insert into t_results (role, label, ok) values ('revânzător', 'vede stocul inițial propriu', (select count(*) from public.partner_par_levels) = 2);
  v := public.submit_refill_counts((select jsonb_agg(jsonb_build_object('product_id', product_id,
    'remaining', case when par_level_quantity = 10 then '3' else '4' end)) from public.partner_par_levels));
  insert into t_results (role, label, ok) values ('revânzător', 'cerere refill: calculează necesarul (10−3=7, 4−4=0)', (v->>'units')::int = 7 and (v->>'items')::int = 1);
  v := public.submit_refill_counts((select jsonb_agg(jsonb_build_object('product_id', product_id, 'remaining', '3')) from public.partner_par_levels where par_level_quantity = 10));
  insert into t_results (role, label, ok) values ('revânzător', 'nu comandă de două ori ce e deja în coș', (v->>'units')::int = 0);
  begin perform public.staff_add_refill(r1, '[]'::jsonb, 'app'); v_ok := false; exception when insufficient_privilege then v_ok := true; end;
  insert into t_results (role, label, ok) values ('revânzător', 'NU poate folosi funcțiile depozitului', v_ok);
  reset role;
  insert into t_results (role, label, ok) values ('revânzător', 'stocul se rezervă imediat',
    (select quantity_reserved from public.warehouse_stock w join public.products p on p.id = w.product_id where p.sku = 'ZZ-T-A') = 7);

  ---------------------------------------------------------------- DEPOZIT: refill deliveries (3 triggers)
  perform set_config('request.jwt.claims', json_build_object('sub', u_dep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into t_results (role, label, ok) values ('depozit', 'primește notificarea „refill nou”', exists (select 1 from public.notifications where type = 'refill_nou'));
  perform public.staff_add_refill(r2, (select jsonb_agg(jsonb_build_object('product_id', id, 'quantity', 2)) from public.products where sku = 'ZZ-T-B'), 'whatsapp');
  insert into t_results (role, label, ok) values ('depozit', 'client prioritar: notificare „livrare imediată”, fără livrare automată',
    exists (select 1 from public.notifications where type = 'client_prioritar')
    and not exists (select 1 from public.deliveries where delivery_group_id = g)
    and (select status from public.partner_carts where partner_id = r2 and status <> 'delivered') = 'open');
  d_imp := public.create_manual_delivery(array(select id from public.partner_carts where partner_id in (r1, r2) and status = 'open'), g);
  perform public.staff_add_refill(r3, (select jsonb_agg(jsonb_build_object('product_id', id, 'quantity', 1)) from public.products where sku = 'ZZ-T-C'), 'telefon');
  d_man := public.create_manual_delivery(array[(select id from public.partner_carts where partner_id = r3 and status = 'open')], null);
  insert into t_results (role, label, ok) values ('depozit', 'trigger manual: creează livrare', d_man is not null);
  insert into t_results (role, label, ok) values ('depozit', 'confirmă pregătirea livrării', public.confirm_delivery_ready(d_imp));
  insert into t_results (role, label, ok) values ('depozit', 'nu poate preda livrarea nefacturată', not public.hand_delivery_to_driver(d_imp));
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', u_fac, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into t_results (role, label, ok) values ('facturare', 'primește notificarea „refill de facturat”', exists (select 1 from public.notifications where type = 'refill_de_facturat'));
  select f.id into ful from public.partner_order_fulfillments f where f.delivery_id = d_imp and f.status = 'ready_to_deliver';
  insert into t_results (role, label, ok) values ('facturare', 'vede livrarea cu produsele pe ecranul de facturare',
    ful is not null and (select count(*) from public.delivery_carts dc join public.partner_cart_items i on i.cart_id = dc.cart_id where dc.delivery_id = d_imp) = 2);
  insert into t_results (role, label, ok) values ('facturare', 'NU poate confirma pregătirea în depozit', not public.confirm_delivery_ready(d_man));
  insert into t_results (role, label, ok) values ('facturare', 'înregistrează factura refill', public.mark_fulfillment_invoiced(ful, 'ZZ-F-1'));
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', u_dep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into t_results (role, label, ok) values ('depozit', 'primește notificarea „facturat, poate pleca”', exists (select 1 from public.notifications where type = 'refill_facturat'));
  insert into t_results (role, label, ok) values ('depozit', 'predă livrarea șoferului', public.hand_delivery_to_driver(d_imp));
  insert into t_results (role, label, ok) values ('depozit', 'anulează propunerea manuală', public.cancel_delivery(d_man));
  reset role;
  insert into t_results (role, label, ok) values ('depozit', 'stocul rezervat se eliberează la predare',
    (select quantity_reserved from public.warehouse_stock w join public.products p on p.id = w.product_id where p.sku = 'ZZ-T-A') = 0);
  insert into t_results (role, label, ok) values ('depozit', 'nu mai există job automat de 48h',
    not exists (select 1 from cron.job where jobname = 'refill-countdown-48h'));

  perform set_config('request.jwt.claims', json_build_object('sub', u_res, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into t_results (role, label, ok) values ('revânzător', 'vede livrarea în istoric', (select count(*) from public.partner_carts where status = 'delivered') = 1);
  reset role;

  ---------------------------------------------------------------- DEPOZIT → FACTURARE: shelf reservation
  perform set_config('request.jwt.claims', json_build_object('sub', u_dep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.staff_add_refill(r1, (select jsonb_agg(jsonb_build_object('product_id', id, 'quantity', 3)) from public.products where sku = 'ZZ-T-A'), 'telefon');
  insert into t_results (role, label, ok) values ('depozit', 'rezervă produsele pe raft',
    public.mark_partner_cart_prepared((select id from public.partner_carts where partner_id = r1 and status = 'open')));
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_fac, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into t_results (role, label, ok) values ('facturare', 'primește „mută în gestiunea Rezervat” cu produsele',
    exists (select 1 from public.notifications where type = 'rezervare_stoc' and message like '%ZZ-T-A%×3%Rezervat%'));
  reset role;

  ---------------------------------------------------------------- OWNER: read-only dashboard
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v := public.dashboard_summary(now() - interval '30 days', now() + interval '1 minute');
  insert into t_results (role, label, ok) values ('owner', 'dashboard: comenzi predate', (v->'online'->>'handed')::int >= 1);
  insert into t_results (role, label, ok) values ('owner', 'dashboard: retururi', (v->'returns'->>'registered')::int >= 1);
  insert into t_results (role, label, ok) values ('owner', 'dashboard: volum per operator', jsonb_array_length(v->'operators') >= 1);
  insert into t_results (role, label, ok) values ('owner', 'NU vede date de client (comenzi)', (select count(*) from public.online_orders) = 0);
  insert into t_results (role, label, ok) values ('owner', 'NU vede revânzătorii', (select count(*) from public.partners) = 0);
  insert into t_results (role, label, ok) values ('owner', 'NU poate prelua comenzi', not public.claim_online_order(o2));
  begin perform public.search_online_orders('ZZFLOW'); v_ok := false; exception when insufficient_privilege then v_ok := true; end;
  insert into t_results (role, label, ok) values ('owner', 'NU poate căuta comenzi', v_ok);
  begin perform public.staff_add_refill(r1, '[]'::jsonb, 'app'); v_ok := false; exception when insufficient_privilege then v_ok := true; end;
  insert into t_results (role, label, ok) values ('owner', 'NU poate adăuga refill', v_ok);
  reset role;

  ---------------------------------------------------------------- ADMIN: oversight
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into t_results (role, label, ok) values ('admin', 'primește notificarea de retur', exists (select 1 from public.notifications where type = 'retur_inregistrat' and related_entity_id = ret));
  insert into t_results (role, label, ok) values ('admin', 'marchează returul în Shopify', public.mark_return_in_shopify(ret));
  insert into t_results (role, label, ok) values ('admin', 'marchează notificările ca citite', public.mark_notifications_read(null) >= 1);
  insert into t_results (role, label, ok) values ('admin', 'vede dashboard-ul', public.dashboard_summary(now() - interval '1 day', now() + interval '1 minute') ? 'online');
  reset role;

  select count(*), count(*) filter (where ok),
    coalesce(string_agg(format('FAIL [%s] %s', role, label), E'\n' order by seq) filter (where not ok or ok is null), '')
    into v_total, v_passed, v_failures from t_results;
  select string_agg(format('%s: %s/%s', role, passed, total), ', ' order by first_seq) into v_text from (
    select role, count(*) filter (where ok) as passed, count(*) as total, min(seq) as first_seq
    from t_results group by role) per_role;
  raise exception E'ROLE FLOWS: %/% passed (%)\n%', v_passed, v_total, v_text, v_failures;
end
$flows$;
