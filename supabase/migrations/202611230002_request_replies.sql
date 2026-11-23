begin;

create table if not exists public.request_replies (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.listings(id) on delete cascade,
  request_title text not null,
  requester_name text not null,
  requester_id uuid not null references auth.users(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  item_title text not null check (length(btrim(item_title)) between 1 and 100),
  description text not null check (length(btrim(description)) between 1 and 1500),
  mode text not null check (mode in ('free', 'sell')),
  price numeric(8,2),
  created_at timestamptz not null default now(),
  check (sender_id <> requester_id),
  check ((mode = 'free' and price is null) or (mode = 'sell' and price is not null and price between 0.01 and 999999.99))
);

create index if not exists request_replies_sender on public.request_replies (sender_id, created_at);
create index if not exists request_replies_requester on public.request_replies (requester_id, created_at);

alter table public.request_replies enable row level security;
revoke all on public.request_replies from anon, authenticated;
grant select on public.request_replies to authenticated;
drop policy if exists request_reply_participants on public.request_replies;
create policy request_reply_participants on public.request_replies for select to authenticated
  using ((select auth.uid()) in (requester_id, sender_id));

create or replace function public.send_request_reply(request_id uuid, item_title text, description text, price numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); request_row public.listings; reply_id uuid;
begin
  if caller is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into request_row from public.listings where id = $1 for share;
  if not found or request_row.kind <> 'request' or request_row.status <> 'available' or request_row.audience <> 'campus'
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

revoke execute on function public.send_request_reply(uuid, text, text, numeric) from public, anon;
grant execute on function public.send_request_reply(uuid, text, text, numeric) to authenticated;

commit;
