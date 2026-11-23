begin;

alter table public.handovers
  drop constraint if exists handovers_place_check,
  drop constraint if exists handovers_place_text_check,
  add constraint handovers_place_text_check check (
    char_length(btrim(place)) between 1 and 100
    and place = btrim(place)
    and place !~ '[[:cntrl:]]'
  );

commit;
