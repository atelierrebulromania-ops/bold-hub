-- Catalog Editor (Editor cataloage): sees only the HoReCa catalogs module. Its own migration because a new
-- enum value cannot be used in the transaction that adds it.
alter type public.user_role add value if not exists 'catalog_editor';
