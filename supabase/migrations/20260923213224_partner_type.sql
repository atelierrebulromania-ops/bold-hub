-- Partners are either resellers (shops) or HoReCa (hotels, restaurants, cafés).
alter table public.resellers
  add column partner_type text not null default 'revanzator'
  check (partner_type in ('revanzator', 'horeca'));
