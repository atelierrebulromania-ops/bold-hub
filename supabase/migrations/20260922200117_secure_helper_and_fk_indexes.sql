-- Supabase's default RLS event trigger is internal plumbing, not an API method.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- FK indexes flagged by the database advisor after the initial schema migration.
create index deliveries_confirmed_by_idx on public.deliveries(confirmed_by);
create index deliveries_triggered_by_reseller_idx on public.deliveries(triggered_by_reseller_id);
create index notifications_reseller_idx on public.notifications(recipient_reseller_id, created_at desc);
create index online_order_items_product_idx on public.online_order_items(product_id);
create index order_returns_registered_by_idx on public.order_returns(registered_by);
create index refill_requests_cart_item_idx on public.refill_requests(cart_item_id);
create index refill_requests_matched_product_idx on public.refill_requests(ai_matched_product_id);
create index reseller_fulfillments_invoiced_by_idx on public.reseller_order_fulfillments(invoiced_by);
create index reseller_fulfillments_ready_by_idx on public.reseller_order_fulfillments(ready_confirmed_by);
create index reseller_par_levels_set_by_idx on public.reseller_par_levels(set_by);
