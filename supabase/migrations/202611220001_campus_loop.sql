begin;

create function public.valid_pickup_slots(slots jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare slot jsonb;
begin
  if jsonb_typeof(slots) is distinct from 'array' then return false; end if;
  if jsonb_array_length(slots) > 12 then return false; end if;
  for slot in select value from jsonb_array_elements(slots) loop
    if coalesce(slot->>'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or coalesce(slot->>'start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(slot->>'end', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or slot->>'end' <= slot->>'start' then return false; end if;
    perform (slot->>'date')::date;
  end loop;
  return true;
exception when datetime_field_overflow or invalid_datetime_format then
  return false;
end;
$$;

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  display_name text not null default 'Campus member',
  kind text not null check (kind in ('offer', 'request')),
  title text not null check (length(btrim(title)) between 1 and 100),
  description text not null check (length(btrim(description)) between 1 and 1500),
  category text not null check (category in ('study', 'home', 'electronics')),
  mode text not null check (mode in ('free', 'sell')),
  condition text check (condition in ('newCondition', 'good', 'fair', 'unknown')),
  defects text not null default '' check (length(defects) <= 300),
  price numeric(8,2),
  audience text not null default 'campus' check (audience in ('campus', 'private')),
  status text not null default 'available' check (status in ('available', 'reserved', 'closed', 'completed')),
  pickup_slots jsonb not null default '[]' check (public.valid_pickup_slots(pickup_slots)),
  pickup_note text not null default '' check (length(pickup_note) <= 300),
  photo text not null default '' check (length(photo) <= 700000 and
    (photo = '' or photo ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$')),
  search_terms text not null default '',
  art text not null default 'box' check (art in ('lamp', 'books', 'box', 'keyboard')),
  simulated boolean not null default false,
  created_at timestamptz not null default now(),
  check (owner_id is not null or simulated),
  check ((kind = 'offer' and condition is not null) or (kind = 'request' and condition is null)),
  check ((kind = 'offer' and mode = 'sell' and price is not null and price between 0.01 and 999999.99)
    or ((kind = 'request' or mode = 'free') and price is null))
);
create index listings_owner on public.listings (owner_id);
create unique index one_recovery_sample_per_owner on public.listings (owner_id) where simulated and owner_id is not null;

create table public.handovers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  item_title text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid references auth.users(id) on delete set null,
  pickup_date date not null,
  pickup_time time not null,
  place text not null check (place in ('library', 'college', 'studentCentre')),
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'awaiting', 'cancelled', 'completed')),
  placed boolean not null default false,
  created_at timestamptz not null default now(),
  check (owner_id <> recipient_id)
);
create unique index one_active_handover on public.handovers (listing_id) where status in ('proposed', 'confirmed', 'awaiting');
create index handovers_owner on public.handovers (owner_id);
create index handovers_recipient on public.handovers (recipient_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  body text not null check (length(btrim(body)) between 1 and 600),
  created_at timestamptz not null default now()
);
create index messages_handover on public.messages (handover_id, created_at);

alter table public.listings enable row level security;
alter table public.handovers enable row level security;
alter table public.messages enable row level security;
revoke all on public.listings, public.handovers, public.messages from anon, authenticated;
grant select on public.listings, public.handovers, public.messages to authenticated;
grant insert (handover_id, sender_id, body) on public.messages to authenticated;

create policy listings_read on public.listings for select to authenticated using (
  owner_id = (select auth.uid()) or
  (audience = 'campus' and status = 'available' and (not simulated or owner_id is null))
);
create policy handover_members_read on public.handovers for select to authenticated
  using ((select auth.uid()) in (owner_id, recipient_id));
create policy message_members_read on public.messages for select to authenticated using (
  exists (select 1 from public.handovers h where h.id = handover_id and (select auth.uid()) in (h.owner_id, h.recipient_id))
);
create policy message_members_write on public.messages for insert to authenticated with check (
  sender_id = (select auth.uid()) and exists (
    select 1 from public.handovers h where h.id = handover_id and (select auth.uid()) in (h.owner_id, h.recipient_id)
      and h.status in ('proposed', 'confirmed', 'awaiting')
  )
);

create function public.save_listing(listing_id uuid, payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); item public.listings; next_art text;
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
  next_art := case payload->>'category' when 'study' then 'books' when 'electronics' then 'keyboard' else 'box' end;
  insert into public.listings (id, owner_id, kind, title, description, category, mode, condition, defects, price,
    audience, pickup_slots, pickup_note, photo, art)
  values (coalesce(listing_id, gen_random_uuid()), caller, payload->>'kind', btrim(payload->>'title'),
    btrim(payload->>'description'), payload->>'category', payload->>'mode', payload->>'condition',
    coalesce(payload->>'defects', ''), (payload->>'price')::numeric, payload->>'audience',
    coalesce(payload->'pickup_slots', '[]'::jsonb), coalesce(payload->>'pickup_note', ''), coalesce(payload->>'photo', ''), next_art)
  on conflict (id) do update set kind = excluded.kind, title = excluded.title, description = excluded.description,
    category = excluded.category, mode = excluded.mode, condition = excluded.condition, defects = excluded.defects,
    price = excluded.price, audience = excluded.audience, pickup_slots = excluded.pickup_slots,
    pickup_note = excluded.pickup_note, photo = excluded.photo, art = excluded.art
  returning id into listing_id;
  return listing_id;
end;
$$;

create function public.propose_handover(listing_id uuid, pickup_date date, pickup_time time, place text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); item public.listings; handover_id uuid;
begin
  if caller is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into item from public.listings where id = listing_id for update;
  if not found or item.owner_id is null or item.owner_id = caller or item.simulated or item.status <> 'available'
    or item.kind <> 'offer' or item.audience <> 'campus' then raise exception 'listing_unavailable'; end if;
  if pickup_date + pickup_time <= (now() at time zone 'Asia/Macau') then raise exception 'past_date'; end if;
  insert into public.handovers (listing_id, item_title, owner_id, recipient_id, pickup_date, pickup_time, place)
    values (item.id, item.title, item.owner_id, caller, pickup_date, pickup_time, place) returning id into handover_id;
  return handover_id;
end;
$$;

create function public.change_handover(handover_id uuid, action text) returns void
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); item public.listings; transfer public.handovers;
begin
  if caller is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select l.* into item from public.listings l join public.handovers h on h.listing_id = l.id
    where h.id = handover_id for update of l;
  select * into transfer from public.handovers where id = handover_id for update;
  if not found or (caller is distinct from transfer.owner_id and caller is distinct from transfer.recipient_id) then
    raise exception 'not_participant' using errcode = '42501';
  end if;
  if action = 'accept' and caller = transfer.owner_id and transfer.status = 'proposed' and item.status = 'available' then
    update public.handovers set status = 'confirmed' where id = transfer.id;
    update public.listings set status = 'reserved' where id = item.id;
  elsif action = 'place' and caller = transfer.owner_id and transfer.status = 'confirmed' then
    update public.handovers set status = 'awaiting', placed = true where id = transfer.id;
  elsif action = 'receive' and caller = transfer.recipient_id and transfer.status = 'awaiting' then
    update public.handovers set status = 'completed' where id = transfer.id;
    update public.listings set status = 'completed' where id = item.id;
  elsif action = 'cancel' and transfer.status in ('proposed', 'confirmed', 'awaiting') then
    update public.handovers set status = 'cancelled' where id = transfer.id;
    if transfer.status <> 'proposed' then update public.listings set status = 'closed' where id = item.id; end if;
  else raise exception 'invalid_transition';
  end if;
end;
$$;

create function public.relist(listing_id uuid, possession text) returns void
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); item public.listings; transfer public.handovers;
begin
  if caller is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into item from public.listings where id = listing_id and owner_id = caller and status = 'closed' for update;
  if not found then raise exception 'listing_unavailable'; end if;
  select * into transfer from public.handovers h where h.listing_id = item.id order by created_at desc, id desc limit 1;
  if not found or transfer.status <> 'cancelled' or possession is distinct from
    (case when transfer.placed then 'retrieved' else 'has' end) then raise exception 'confirm_possession'; end if;
  update public.listings set status = 'available' where id = item.id;
end;
$$;

create function public.seed_recovery() returns uuid
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); item uuid; transfer uuid; today date := (now() at time zone 'Asia/Macau')::date;
begin
  if caller is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  insert into public.listings (owner_id, display_name, kind, title, description, category, mode, condition,
      defects, status, art, simulated, pickup_slots)
    values (caller, 'Demo Mei', 'offer', 'Introduction to Algorithms', 'A usable copy with all pages intact.',
      'study', 'free', 'good', 'Small fold on the cover.', 'closed', 'books', true,
      jsonb_build_array(jsonb_build_object('date', today::text, 'start', '18:00', 'end', '20:00')))
    on conflict (owner_id) where simulated and owner_id is not null do nothing returning id into item;
  if item is null then
    select id into item from public.listings where owner_id = caller and simulated;
    return item;
  end if;
  insert into public.handovers (listing_id, item_title, owner_id, pickup_date, pickup_time, place, status, placed)
    values (item, 'Introduction to Algorithms', caller, today, '18:00', 'library', 'cancelled', true)
    returning id into transfer;
  insert into public.messages (handover_id, body) values (transfer, 'Demo Rui: I can no longer make the pickup.');
  return item;
end;
$$;

revoke execute on function public.save_listing(uuid, jsonb), public.propose_handover(uuid, date, time, text),
  public.change_handover(uuid, text), public.relist(uuid, text), public.seed_recovery() from public, anon;
grant execute on function public.save_listing(uuid, jsonb), public.propose_handover(uuid, date, time, text),
  public.change_handover(uuid, text), public.relist(uuid, text), public.seed_recovery() to authenticated;

commit;
