-- Marketing communication calendar: the year's campaigns and events on one visual board (months across,
-- categories down). Only active administrators and marketing users can read or change it, checked by row
-- security on the tables and on the images bucket.

-- Compared as text, so this migration does not depend on the enum value existing yet.
create function private.can_edit_marketing_calendar() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select private.current_role())::text in ('admin', 'marketing'), false) $$;
revoke all on function private.can_edit_marketing_calendar() from public, anon;
grant execute on function private.can_edit_marketing_calendar() to authenticated;

-- Rows of the board. "band": the thin strip at the top (product lines, stock-in notes); "events": the rest.
create table public.marketing_lanes (
  id uuid primary key default gen_random_uuid(),
  name text not null constraint marketing_lanes_name_check check (char_length(btrim(name)) between 1 and 60),
  subtitle text not null default '' constraint marketing_lanes_subtitle_check check (char_length(subtitle) <= 160),
  kind text not null default 'events' constraint marketing_lanes_kind_check check (kind in ('band', 'events')),
  -- Show a campaign picture under each event (the main communication row).
  show_images boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.marketing_events (
  id uuid primary key default gen_random_uuid(),
  lane_id uuid not null references public.marketing_lanes(id) on delete cascade,
  title text not null constraint marketing_events_title_check check (char_length(btrim(title)) between 1 and 80),
  start_date date not null,
  end_date date not null,
  -- Dates not final yet: the board says "TBC".
  dates_tbc boolean not null default false,
  -- Print the dates on the board, as "(15 IAN – 30 MAR)".
  show_dates boolean not null default true,
  color text not null default 'dark' constraint marketing_events_color_check check (color in ('dark', 'grey', 'light', 'purple', 'orange', 'red')),
  -- Band rows only: the stock-in note printed above the block ("End of Nov'26").
  stock_in text constraint marketing_events_stock_in_check check (char_length(stock_in) <= 60),
  notes text constraint marketing_events_notes_check check (char_length(notes) <= 600),
  image_path text constraint marketing_events_image_path_check check (image_path ~ '^events/[0-9a-f-]{36}\.(jpg|png)$'),
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.app_users(id) on delete set null,
  constraint marketing_events_dates_check check (end_date >= start_date and end_date - start_date <= 400)
);
create index marketing_events_lane_idx on public.marketing_events (lane_id, start_date);
create index marketing_events_dates_idx on public.marketing_events (start_date, end_date);

alter table public.marketing_lanes enable row level security;
alter table public.marketing_events enable row level security;
create policy marketing_editors on public.marketing_lanes for all to authenticated
  using ((select private.can_edit_marketing_calendar())) with check ((select private.can_edit_marketing_calendar()));
create policy marketing_editors on public.marketing_events for all to authenticated
  using ((select private.can_edit_marketing_calendar())) with check ((select private.can_edit_marketing_calendar()));
revoke all on public.marketing_lanes, public.marketing_events from anon;
grant select, insert, update, delete on public.marketing_lanes, public.marketing_events to authenticated;

-- Campaign pictures: private bucket, reachable only by marketing users and administrators (the app streams
-- them after the same check). JPEG/PNG only, at most 8 MB; the browser resizes before uploading.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marketing-calendar-images', 'marketing-calendar-images', false, 8388608, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy marketing_calendar_images_read on storage.objects for select to authenticated
  using (bucket_id = 'marketing-calendar-images' and (select private.can_edit_marketing_calendar()));
create policy marketing_calendar_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'marketing-calendar-images' and (select private.can_edit_marketing_calendar())
    and name ~ '^events/[0-9a-f-]{36}\.(jpg|png)$');
create policy marketing_calendar_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'marketing-calendar-images' and (select private.can_edit_marketing_calendar()));
