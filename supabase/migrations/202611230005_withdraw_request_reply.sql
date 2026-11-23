begin;

-- The sender of a request reply can withdraw it. The row is deleted, so the requester no longer sees it.
create or replace function public.withdraw_request_reply(reply_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  delete from public.request_replies where id = $1 and sender_id = caller;
  if not found then raise exception 'request_unavailable'; end if;
end;
$$;

revoke execute on function public.withdraw_request_reply(uuid) from public, anon;
grant execute on function public.withdraw_request_reply(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
