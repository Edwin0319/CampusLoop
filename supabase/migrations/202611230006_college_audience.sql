begin;
-- Adds a third audience: students who chose the same residential college.
-- The college is self-declared in a profile and is not verified.

create table if not exists public.profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  college text check (college in ('cytc', 'ckpc', 'cklc', 'ckyc', 'hfpjc', 'lcwc', 'mlc', 'mcmc', 'spc', 'sheac')),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
drop policy if exists profiles_own_read on public.profiles;
create policy profiles_own_read on public.profiles for select to authenticated using (user_id = (select auth.uid()));

-- Viewer's college, readable inside policies without exposing other people's profiles.
create or replace function public.viewer_college() returns text
language sql stable security definer set search_path = '' as $$
  select college from public.profiles where user_id = auth.uid()
$$;

create or replace function public.set_college(college text) returns void
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  insert into public.profiles (user_id, college, updated_at) values (caller, nullif($1, ''), now())
    on conflict (user_id) do update set college = excluded.college, updated_at = now();
end;
$$;
revoke execute on function public.viewer_college(), public.set_college(text) from public, anon;
grant execute on function public.viewer_college(), public.set_college(text) to authenticated;

alter table public.listings
  add column if not exists college text,
  drop constraint if exists listings_audience_check,
  drop constraint if exists listings_college_check;
alter table public.listings
  add constraint listings_audience_check check (audience in ('campus', 'college', 'private')),
  add constraint listings_college_check check (
    (audience = 'college') = (college is not null)
    and (college is null or college in ('cytc', 'ckpc', 'cklc', 'ckyc', 'hfpjc', 'lcwc', 'mlc', 'mcmc', 'spc', 'sheac'))
  );

-- True when the caller may see and respond to a listing published to the feed.
create or replace function public.listing_reachable(audience text, college text) returns boolean
language sql stable security definer set search_path = '' as $$
  -- coalesce: a viewer without a college gets false, not null (callers negate this).
  select coalesce($1 = 'campus' or ($1 = 'college' and $2 = public.viewer_college()), false)
$$;
revoke execute on function public.listing_reachable(text, text) from public, anon;
grant execute on function public.listing_reachable(text, text) to authenticated;

drop policy if exists listings_read on public.listings;
create policy listings_read on public.listings for select to authenticated using (
  owner_id = (select auth.uid()) or
  (status = 'available' and (not simulated or owner_id is null) and public.listing_reachable(audience, college))
);

create or replace function public.save_listing(listing_id uuid, payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  item public.listings;
  next_art text;
  next_categories text[];
  next_college text;
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
  -- A college-only listing always uses the poster's own college, never one named in the payload.
  if payload->>'audience' = 'college' then
    select p.college into next_college from public.profiles p where p.user_id = caller;
    if next_college is null then raise exception 'college_required'; end if;
  end if;
  next_art := case payload->>'category' when 'study' then 'books' when 'electronics' then 'keyboard' else 'box' end;
  insert into public.listings (id, owner_id, kind, title, description, category, categories, mode, condition, defects,
    price, audience, college, pickup_slots, pickup_note, photo, art)
  values (coalesce(listing_id, gen_random_uuid()), caller, payload->>'kind', btrim(payload->>'title'),
    btrim(payload->>'description'), payload->>'category', next_categories, payload->>'mode', payload->>'condition',
    coalesce(payload->>'defects', ''), (payload->>'price')::numeric, payload->>'audience', next_college,
    coalesce(payload->'pickup_slots', '[]'::jsonb), coalesce(payload->>'pickup_note', ''), coalesce(payload->>'photo', ''), next_art)
  on conflict (id) do update set kind = excluded.kind, title = excluded.title, description = excluded.description,
    category = excluded.category, categories = excluded.categories, mode = excluded.mode, condition = excluded.condition,
    defects = excluded.defects, price = excluded.price, audience = excluded.audience, college = excluded.college,
    pickup_slots = excluded.pickup_slots, pickup_note = excluded.pickup_note, photo = excluded.photo, art = excluded.art
  returning id into listing_id;
  return listing_id;
end;
$$;

create or replace function public.propose_handover(listing_id uuid, pickup_date date, pickup_time time, place text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); item public.listings; handover_id uuid;
begin
  if caller is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into item from public.listings where id = listing_id for update;
  if not found or item.owner_id is null or item.owner_id = caller or item.simulated or item.status <> 'available'
    or item.kind <> 'offer' or not public.listing_reachable(item.audience, item.college) then
    raise exception 'listing_unavailable';
  end if;
  if pickup_date + pickup_time <= (now() at time zone 'Asia/Macau') then raise exception 'past_date'; end if;
  insert into public.handovers (listing_id, item_title, owner_id, recipient_id, pickup_date, pickup_time, place)
    values (item.id, item.title, item.owner_id, caller, pickup_date, pickup_time, place) returning id into handover_id;
  return handover_id;
end;
$$;

create or replace function public.send_request_reply(request_id uuid, item_title text, description text, price numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); request_row public.listings; reply_id uuid;
begin
  if caller is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into request_row from public.listings where id = $1 for share;
  if not found or request_row.kind <> 'request' or request_row.status <> 'available'
    or not public.listing_reachable(request_row.audience, request_row.college)
    or request_row.simulated or request_row.owner_id is null or request_row.owner_id = caller then
    raise exception 'request_unavailable';
  end if;
  insert into public.request_replies (request_id, request_title, requester_name, requester_id, sender_id,
      item_title, description, mode, price)
    values (request_row.id, request_row.title, request_row.display_name, request_row.owner_id, caller,
      btrim($2), btrim($3), request_row.mode, $4) returning id into reply_id;
  return reply_id;
end;
$$;

-- Fictional sample shown only to viewers who chose Cheng Yu Tung College.
insert into public.listings (id, kind, title, description, category, categories, mode, condition, defects, price,
  audience, college, display_name, search_terms, art, simulated)
values ('5c0d7f2e-8a41-4b6e-9f3a-2d1c7e9b4a60', 'offer', 'Electric kettle for the floor pantry',
  'For students in Cheng Yu Tung College. Pick up at the college pantry.', 'kitchen', array['kitchen'], 'free', 'good',
  'Some limescale inside.', null, 'college', 'cytc', 'Demo Lin', '電熱水壺 电热水壶 熱水煲 chaleira elétrica', 'box', true)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
commit;
