-- Communication calendar v2: no product-line band, one colour per category (events take it automatically),
-- and a read-only share link.

-- The product-line band goes away with its blocks.
delete from public.marketing_lanes where kind = 'band';
alter table public.marketing_lanes drop constraint marketing_lanes_kind_check;
alter table public.marketing_lanes add constraint marketing_lanes_kind_check check (kind = 'events');

-- Each category has its colour from the original palette; its events are drawn in it.
alter table public.marketing_lanes add column color text not null default 'dark'
  constraint marketing_lanes_color_check check (color in ('dark', 'grey', 'light', 'purple', 'orange', 'red'));
update public.marketing_lanes set color = case
  when name ilike 'MAIN%' then 'dark'
  when name ilike 'SECONDARY%' then 'grey'
  when name ilike 'COMMERCIAL%' then 'purple'
  when name ilike 'EXTRAS%' then 'orange'
  else 'dark' end;

-- One share link for the whole calendar: whoever has it sees the board (any year), read-only. Only
-- editors can read or change the token; the shared page looks it up on the server.
create table public.marketing_share_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique constraint marketing_share_links_token_check check (token ~ '^[A-Za-z0-9_-]{32,64}$'),
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users(id) on delete set null
);
alter table public.marketing_share_links enable row level security;
create policy marketing_editors on public.marketing_share_links for all to authenticated
  using ((select private.can_edit_marketing_calendar())) with check ((select private.can_edit_marketing_calendar()));
revoke all on public.marketing_share_links from anon;
grant select, insert, delete on public.marketing_share_links to authenticated;
