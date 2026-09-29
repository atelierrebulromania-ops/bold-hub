-- The warehouse puts a proforma's cart on the shelf; the app then needs the proforma (and its BOCP
-- order, which already reserves the stock) so it does not reserve the same products twice.
create policy warehouse_cart_documents on public.sales_documents for select
  using ((select private.current_role()) = 'operator_depozit' and cart_id is not null);
