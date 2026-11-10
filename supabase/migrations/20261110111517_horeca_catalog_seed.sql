-- First catalog, taken exactly from "ES – LISTA DE PRECIOS HORECA – Oct 2026.pdf": the three Signature
-- collections, their products in the order of the pages, prices (EUR, without VAT), volumes and codes.
-- Photos are the ones extracted from that PDF, shipped with the app as seed/<code>.jpg. Runs once.
do $seed$
declare
  v_catalog uuid;
  v_collection uuid;
  v_row record;
begin
  if exists (select 1 from public.horeca_catalogs where title = 'HoReCa Spania – Octombrie 2026') then return; end if;

  insert into public.horeca_catalogs (title, language, currency, cover_title, cover_subtitle, website, terms_vat, terms_payment)
  values ('HoReCa Spania – Octombrie 2026', 'es', 'EUR', 'HO RE CA', 'LISTA DE PRECIOS', 'www.atelierrebul.ro',
    'Los precios no incluyen IVA.',
    'Los precios están expresados en Euros y el pago se realizará mediante Transferencia Bancaria a la entrega del producto.')
  returning id into v_catalog;

  for v_row in
    select * from (values
      (1, 'ISTANBUL', 1, 'JABÓN LÍQUIDO ISTANBUL DE PARED', 6.59, 550, 'AT03126'),
      (1, 'ISTANBUL', 2, 'LOCIÓN MANOS Y CUERPO ISTANBUL DE PARED', 6.59, 550, 'AT03127'),
      (1, 'ISTANBUL', 3, 'CHAMPÚ ISTANBUL DE PARED', 6.59, 550, 'AT03121'),
      (1, 'ISTANBUL', 4, 'GEL DE DUCHA ISTANBUL DE PARED', 6.59, 550, 'AT03124'),
      (1, 'ISTANBUL', 5, 'ACONDICIONADOR ISTANBUL DE PARED', 6.59, 550, 'AT03122'),
      (2, 'MANDARINE', 1, 'CHAMPÚ MANDARINE DE PARED', 6.05, 500, 'AT03014'),
      (2, 'MANDARINE', 2, 'LOCIÓN MANOS Y CUERPO MANDARINE DE PARED', 6.05, 500, 'AT03017'),
      (2, 'MANDARINE', 3, 'ACONDICIONADOR MANDARINE DE PARED', 6.05, 500, 'AT03015'),
      (2, 'MANDARINE', 4, 'JABÓN LÍQUIDO MANDARINE DE PARED', 6.05, 500, 'AT03112'),
      (2, 'MANDARINE', 5, 'GEL DE DUCHA MANDARINE DE PARED', 6.05, 500, 'AT03016'),
      (3, '1895', 1, 'CHAMPÚ 1895 DE PARED', 6.59, 550, 'AT03661'),
      (3, '1895', 2, 'ACONDICIONADOR 1895 DE PARED', 6.59, 550, 'AT03662'),
      (3, '1895', 3, 'GEL DE DUCHA 1895 DE PARED', 6.59, 550, 'AT03658'),
      (3, '1895', 4, 'JABÓN LÍQUIDO 1895 DE PARED', 6.59, 550, 'AT03660'),
      (3, '1895', 5, 'LOCIÓN MANOS Y CUERPO 1895 DE PARED', 6.59, 550, 'AT03659')
    ) as t(collection_position, collection_name, product_position, product_name, price, ml, sku)
    order by collection_position, product_position
  loop
    select id into v_collection from public.horeca_catalog_collections
      where catalog_id = v_catalog and name = v_row.collection_name;
    if v_collection is null then
      insert into public.horeca_catalog_collections (catalog_id, label, name, position)
        values (v_catalog, 'COLECCIÓN SIGNATURE', v_row.collection_name, v_row.collection_position)
        returning id into v_collection;
    end if;
    insert into public.horeca_catalog_products (catalog_id, collection_id, name, price, size_value, size_unit, sku, image_path, position)
      values (v_catalog, v_collection, v_row.product_name, v_row.price, v_row.ml, 'ml', v_row.sku, 'seed/' || v_row.sku || '.jpg', v_row.product_position);
  end loop;
end
$seed$;
