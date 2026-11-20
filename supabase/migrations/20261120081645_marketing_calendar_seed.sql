-- The 2027 global communication calendar, taken from "2027 GLOBAL COMMUNICATION CALENDAR". Dates printed on
-- the original are used as they are; the others are read from where the block sits on the original and are
-- meant to be adjusted in the app. Runs once (only while the calendar is empty).
do $seed$
declare
  v_band uuid; v_main uuid; v_secondary uuid; v_commercial uuid; v_extras uuid;
begin
  if exists (select 1 from public.marketing_lanes) then return; end if;

  insert into public.marketing_lanes (name, subtitle, kind, show_images, position) values ('LINIE DE PRODUS', '', 'band', false, 1) returning id into v_band;
  insert into public.marketing_lanes (name, subtitle, kind, show_images, position) values ('MAIN COMMUNICATION', '(windows, ecom main banner, SM, performance marketing)', 'events', true, 2) returning id into v_main;
  insert into public.marketing_lanes (name, subtitle, kind, show_images, position) values ('SECONDARY', '(ecom secondary banner, performance marketing)', 'events', false, 3) returning id into v_secondary;
  insert into public.marketing_lanes (name, subtitle, kind, show_images, position) values ('COMMERCIAL EVENTS/DAYS', '(in store comms, ecom banner, performance marketing)', 'events', false, 4) returning id into v_commercial;
  insert into public.marketing_lanes (name, subtitle, kind, show_images, position) values ('EXTRAS', '', 'events', false, 5) returning id into v_extras;

  insert into public.marketing_events (lane_id, title, start_date, end_date, dates_tbc, show_dates, color, stock_in) values
    -- Product lines and stock-in
    (v_band, 'FRAGRANCE', '2027-01-01', '2027-03-31', false, false, 'grey', 'End of Nov''26'),
    (v_band, 'HOME', '2027-04-01', '2027-05-31', false, false, 'dark', 'March''27 TBC'),
    (v_band, 'FRAGRANCE', '2027-06-01', '2027-07-31', false, false, 'grey', null),
    (v_band, 'HOME', '2027-08-01', '2027-09-30', false, false, 'dark', null),
    (v_band, 'FRAGRANCE', '2027-10-01', '2027-10-31', false, false, 'grey', null),
    (v_band, 'HOME', '2027-11-01', '2027-12-31', false, false, 'dark', 'End Aug''27'),
    -- Main communication
    (v_main, 'WINTER SALE', '2027-01-01', '2027-01-31', true, true, 'dark', null),
    (v_main, 'OLFACTIVE CLASH', '2027-01-15', '2027-03-30', false, true, 'dark', null),
    (v_main, 'NEW FRENCH HERITAGE', '2027-04-01', '2027-05-10', false, true, 'dark', null),
    (v_main, 'BODY MIST EXTENSION', '2027-05-10', '2027-08-01', false, true, 'dark', null),
    (v_main, 'GH EXT+ REVISIT', '2027-08-02', '2027-08-31', false, true, 'dark', null),
    (v_main, 'HOME ARTIST COLLAB', '2027-09-01', '2027-09-30', false, true, 'dark', null),
    (v_main, 'OC REVISIT', '2027-10-01', '2027-11-11', false, true, 'dark', null),
    (v_main, 'NEW YEAR & AOG', '2027-11-12', '2027-12-30', false, true, 'dark', null),
    -- Secondary
    (v_secondary, 'ISTANBUL SIGNATURE (CORE)', '2027-01-01', '2027-01-31', false, false, 'dark', null),
    (v_secondary, 'GOLDEN HOUR', '2027-03-01', '2027-04-05', false, false, 'dark', null),
    (v_secondary, 'BOSPHORUS', '2027-05-01', '2027-06-30', false, false, 'dark', null),
    (v_secondary, 'ISTANBUL FAMILY REED OCTAGONAL BOTTLE DESIGN', '2027-06-01', '2027-08-31', false, false, 'light', null),
    (v_secondary, 'SUMMER SALE', '2027-08-01', '2027-09-05', false, false, 'dark', null),
    (v_secondary, 'BACK TO CITY: ISTANBUL', '2027-09-07', '2027-11-08', false, false, 'dark', null),
    -- Commercial events / days
    (v_commercial, 'AOG V-DAY', '2027-02-01', '2027-02-14', false, false, 'purple', null),
    (v_commercial, 'AOG EID #1', '2027-02-20', '2027-03-12', false, false, 'purple', null),
    (v_commercial, 'AOG WOMEN''S DAY', '2027-02-26', '2027-03-08', false, false, 'purple', null),
    (v_commercial, 'AOG MOTHERS'' DAY', '2027-04-26', '2027-05-09', false, false, 'purple', null),
    (v_commercial, 'AOG EID #2', '2027-05-06', '2027-05-19', false, false, 'purple', null),
    (v_commercial, 'AOG FATHERS'' DAY', '2027-06-08', '2027-06-20', false, false, 'purple', null),
    (v_commercial, 'AOG TEACHERS'' DAY', '2027-11-01', '2027-11-27', false, false, 'purple', null),
    (v_commercial, 'BLACK FRIDAY & 11.11', '2027-11-01', '2027-11-30', false, false, 'red', null),
    -- Extras
    (v_extras, 'MAISON & OBJET', '2027-01-15', '2027-01-19', false, false, 'orange', null),
    (v_extras, 'RAMADAN & EID', '2027-03-09', '2027-03-12', false, true, 'dark', null),
    (v_extras, 'FRAGRANCE DAY', '2027-03-21', '2027-03-21', false, true, 'dark', null),
    (v_extras, 'EASTER', '2027-03-26', '2027-03-29', false, true, 'dark', null),
    (v_extras, 'ESXENCE MILAN', '2027-04-01', '2027-04-30', false, false, 'orange', null),
    (v_extras, 'EID', '2027-05-16', '2027-05-19', false, true, 'dark', null),
    (v_extras, 'MAISON & OBJET', '2027-09-01', '2027-09-30', false, false, 'orange', null),
    (v_extras, 'CONT. ISTANBUL', '2027-09-01', '2027-09-30', false, false, 'dark', null),
    (v_extras, 'BREAST CANCER AWARENESS', '2027-10-01', '2027-10-31', false, false, 'dark', null),
    (v_extras, 'HALLOWEEN', '2027-10-31', '2027-10-31', false, false, 'dark', null),
    (v_extras, 'CANNES TFWA', '2027-10-01', '2027-10-31', false, false, 'orange', null),
    (v_extras, 'UNBOXING DAY UK', '2027-12-26', '2027-12-26', false, false, 'dark', null);
end
$seed$;
