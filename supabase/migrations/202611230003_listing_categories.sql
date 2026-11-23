begin;

alter table public.listings
  add column if not exists categories text[],
  drop constraint if exists listings_category_check,
  drop constraint if exists listings_categories_check;

alter table public.listings
  add constraint listings_category_check check (category in (
    'study', 'home', 'electronics', 'clothing', 'kitchen', 'furniture', 'sports', 'hobbies', 'transport', 'otherItems'
  )),
  add constraint listings_categories_check check (categories is null or (
    cardinality(categories) between 1 and 10
    and array_position(categories, null) is null
    and categories <@ array['study', 'home', 'electronics', 'clothing', 'kitchen', 'furniture', 'sports', 'hobbies', 'transport', 'otherItems']
    and category = categories[1]
  ));

create or replace function public.save_listing(listing_id uuid, payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  item public.listings;
  next_art text;
  next_categories text[];
begin
  if caller is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if listing_id is not null then
    select * into item from public.listings where id = listing_id and owner_id = caller for update;
    if not found then raise exception 'not_owner' using errcode = '42501'; end if;
    if item.status <> 'available' or exists (select 1 from public.handovers h
      where h.listing_id = item.id and h.status in ('proposed', 'confirmed', 'awaiting')) then
      raise exception 'listing_locked';
    end if;
  end if;

  if payload ? 'categories' then
    next_categories := array(select jsonb_array_elements_text(payload->'categories'));
  elsif item.category = payload->>'category' then
    next_categories := item.categories;
  end if;

  next_art := case payload->>'category' when 'study' then 'books' when 'electronics' then 'keyboard' else 'box' end;
  insert into public.listings (id, owner_id, kind, title, description, category, categories, mode, condition, defects,
    price, audience, pickup_slots, pickup_note, photo, art)
  values (coalesce(listing_id, gen_random_uuid()), caller, payload->>'kind', btrim(payload->>'title'),
    btrim(payload->>'description'), payload->>'category', next_categories, payload->>'mode', payload->>'condition',
    coalesce(payload->>'defects', ''), (payload->>'price')::numeric, payload->>'audience',
    coalesce(payload->'pickup_slots', '[]'::jsonb), coalesce(payload->>'pickup_note', ''), coalesce(payload->>'photo', ''), next_art)
  on conflict (id) do update set kind = excluded.kind, title = excluded.title, description = excluded.description,
    category = excluded.category, categories = excluded.categories, mode = excluded.mode, condition = excluded.condition,
    defects = excluded.defects, price = excluded.price, audience = excluded.audience, pickup_slots = excluded.pickup_slots,
    pickup_note = excluded.pickup_note, photo = excluded.photo, art = excluded.art
  returning id into listing_id;
  return listing_id;
end;
$$;

notify pgrst, 'reload schema';

commit;
