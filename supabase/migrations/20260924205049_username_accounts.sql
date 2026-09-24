-- Accounts log in with a username. Supabase Auth still needs an email, so each account gets a
-- technical one (<username>@users.boldhub.invalid) that nobody sees; the username stored here
-- is for display. The notification email is separate, optional and may be shared by several users.
alter table public.app_users
  add column username text unique check (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  add column notification_email text check (notification_email is null
    or (char_length(notification_email) <= 254 and notification_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'));

alter table public.partners
  add column account_username text unique check (account_username ~ '^[a-z0-9][a-z0-9._-]{2,31}$');
