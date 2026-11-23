begin;
-- Aligns the database with Report 3 (R-F2, R-F3, R-E1).

-- R-F2: five-level condition scale. 'newCondition' keeps its meaning (Like new); 'good' and 'fair' become 'working'.
alter table public.listings drop constraint if exists listings_condition_check;
update public.listings set condition = 'working' where condition in ('good', 'fair');
alter table public.listings add constraint listings_condition_check
  check (condition in ('brandNew', 'newCondition', 'working', 'hasDefects', 'unknown'));

-- R-F2: replies to requests describe the offered item's condition and defects too. Older replies keep null.
alter table public.request_replies
  add column if not exists condition text,
  add column if not exists defects text not null default '',
  drop constraint if exists request_replies_condition_check,
  drop constraint if exists request_replies_defects_check;
alter table public.request_replies
  add constraint request_replies_condition_check
    check (condition is null or condition in ('brandNew', 'newCondition', 'working', 'hasDefects', 'unknown')),
  add constraint request_replies_defects_check check (length(defects) <= 300);

-- The four-argument version without condition is replaced, so every new reply states its condition.
drop function if exists public.send_request_reply(uuid, text, text, numeric);
drop function if exists public.send_request_reply(uuid, text, text, numeric, text, text);
create function public.send_request_reply(request_id uuid, item_title text, description text, price numeric,
  condition text, defects text) returns uuid
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
  if $5 is null or ($5 = 'hasDefects' and btrim(coalesce($6, '')) = '') then raise exception 'condition_required'; end if;
  insert into public.request_replies (request_id, request_title, requester_name, requester_id, sender_id,
      item_title, description, mode, price, condition, defects)
    values (request_row.id, request_row.title, request_row.display_name, request_row.owner_id, caller,
      btrim($2), btrim($3), request_row.mode, $4, $5, btrim(coalesce($6, ''))) returning id into reply_id;
  return reply_id;
end;
$$;
revoke execute on function public.send_request_reply(uuid, text, text, numeric, text, text) from public, anon;
grant execute on function public.send_request_reply(uuid, text, text, numeric, text, text) to authenticated;

-- R-F3: both participants can read the listing of their handover, so they see the same terms.
-- A cancelled handover gives no access, so a relisted item follows its chosen audience again (R-P1).
drop policy if exists listings_read on public.listings;
create policy listings_read on public.listings for select to authenticated using (
  owner_id = (select auth.uid()) or
  (status = 'available' and (not simulated or owner_id is null) and public.listing_reachable(audience, college)) or
  exists (select 1 from public.handovers h where h.listing_id = listings.id and h.status <> 'cancelled'
    and (select auth.uid()) in (h.owner_id, h.recipient_id))
);

-- R-F3: the owner records either an in-person handover ('hand') or placement at the collection point ('place').
create or replace function public.change_handover(handover_id uuid, action text) returns void
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
  elsif action = 'hand' and caller = transfer.owner_id and transfer.status = 'confirmed' then
    update public.handovers set status = 'awaiting', placed = false where id = transfer.id;
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

-- R-E1: offering the item again keeps its details and audience but drops pickup times that have passed.
create or replace function public.relist(listing_id uuid, possession text) returns void
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); item public.listings; transfer public.handovers;
  now_local timestamp := now() at time zone 'Asia/Macau';
begin
  if caller is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into item from public.listings where id = listing_id and owner_id = caller and status = 'closed' for update;
  if not found then raise exception 'listing_unavailable'; end if;
  select * into transfer from public.handovers h where h.listing_id = item.id order by created_at desc, id desc limit 1;
  if not found or transfer.status <> 'cancelled' or possession is distinct from
    (case when transfer.placed then 'retrieved' else 'has' end) then raise exception 'confirm_possession'; end if;
  update public.listings set status = 'available', pickup_slots = coalesce((
    select jsonb_agg(slot) from jsonb_array_elements(item.pickup_slots) slot
    where ((slot->>'date')::date + (slot->>'end')::time) > now_local), '[]'::jsonb)
  where id = item.id;
end;
$$;

-- The relisting sample used the old 'good' value.
create or replace function public.seed_recovery() returns uuid
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); item uuid; transfer uuid; today date := (now() at time zone 'Asia/Macau')::date;
begin
  if caller is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  insert into public.listings (owner_id, display_name, kind, title, description, category, mode, condition,
      defects, status, art, simulated, pickup_slots)
    values (caller, 'Demo Mei', 'offer', 'Introduction to Algorithms', 'A usable copy with all pages intact.',
      'study', 'free', 'working', 'Small fold on the cover.', 'closed', 'books', true,
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

notify pgrst, 'reload schema';
commit;
