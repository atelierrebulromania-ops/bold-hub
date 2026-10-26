-- Accounting (contabilitate): sees only the Accounting module, for the companies it is allowed.
alter type public.user_role add value if not exists 'contabilitate';
