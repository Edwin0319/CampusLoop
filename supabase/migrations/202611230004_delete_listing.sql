begin;

-- Owners can permanently delete their own listing once no handover is in progress.
-- Past handovers, their messages, and request replies are removed by the existing cascades.
create or replace function public.delete_listing(listing_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); item public.listings;
begin
  if caller is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into item from public.listings where id = $1 and owner_id = caller for update;
  if not found or item.simulated then raise exception 'not_owner' using errcode = '42501'; end if;
  if exists (select 1 from public.handovers h
    where h.listing_id = item.id and h.status in ('proposed', 'confirmed', 'awaiting')) then
    raise exception 'listing_locked';
  end if;
  delete from public.listings where id = item.id;
end;
$$;

revoke execute on function public.delete_listing(uuid) from public, anon;
grant execute on function public.delete_listing(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
