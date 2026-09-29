-- New staff role "account" (account manager for B2B partners). Its permissions come later;
-- for now it only exists so accounts can be created and its screens developed.
alter type public.user_role add value if not exists 'account';
