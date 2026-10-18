-- One open cart per client and point of work (not per client).
drop index public.partner_one_active_cart;
create unique index partner_one_active_cart on public.partner_carts (partner_id, location_id) nulls not distinct
  where status = any (array['open'::public.cart_status, 'pending_delivery'::public.cart_status]);
