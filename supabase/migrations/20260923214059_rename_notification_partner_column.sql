-- Completes the partners rename: mark_notifications_read already refers to recipient_partner_id.
alter table public.notifications rename column recipient_reseller_id to recipient_partner_id;
