-- Apply once after the existing setup scripts. Preserves wishes and price history.
begin;
alter table public.wish_items
  add column priority text not null default 'idea' check (priority in ('idea','really_want')),
  add column gift_preferences text not null default '' check (length(gift_preferences) <= 1000),
  add column status text not null default 'active' check (status in ('active','received','archived'));
grant update(priority,gift_preferences,status) on public.wish_items to authenticated;

-- Transfers need list_id writes without granting arbitrary column writes to clients.
-- Keep the privileged implementation private and bind every check to auth.uid().
create function private.transfer_wishes(target uuid, mode text, entries jsonb)
returns setof public.wish_items language plpgsql security definer set search_path = '' as $$
declare
  entry jsonb;
  source public.wish_items;
  saved public.wish_items;
  copy_id uuid;
begin
  if auth.uid() is null or not private.can_access_list(target,true) then
    raise exception 'Editing access to the destination is required' using errcode='42501';
  end if;
  if mode not in ('move','copy') or mode is null or entries is null or jsonb_typeof(entries) <> 'array'
     or jsonb_array_length(entries) not between 1 and 50 then
    raise exception 'Invalid transfer';
  end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(entries)) <> jsonb_array_length(entries)
     or (select count(distinct value->>'copy_id') from jsonb_array_elements(entries)) <> jsonb_array_length(entries) then
    raise exception 'Select each wish once';
  end if;
  -- Consistent lock order avoids deadlocks between overlapping bulk operations.
  perform 1 from public.wish_items where id in
    (select (value->>'id')::uuid from jsonb_array_elements(entries)) order by id for update;
  for entry in select value from jsonb_array_elements(entries) loop
    select * into source from public.wish_items where id=(entry->>'id')::uuid;
    if not found or not private.can_access_list(source.list_id,mode='move') then
      raise exception 'Access to a source wish is required' using errcode='42501';
    end if;
    if mode='move' then
      update public.wish_items set list_id=target where id=source.id returning * into saved;
    else
      copy_id := (entry->>'copy_id')::uuid;
      if copy_id is null or copy_id=source.id then raise exception 'Invalid copy ID'; end if;
      -- Stable copy IDs make retries safe, including after the copy has been edited.
      select * into saved from public.wish_items where id=copy_id;
      if found then
        if saved.list_id<>target then raise exception 'Copy ID already in use' using errcode='42501'; end if;
      else
        insert into public.wish_items(id,list_id,name,variant,category,notes,msrp_cents,msrp_source_url,
          offers,image_url,image_source_url,image_mode,priority,gift_preferences,status)
        values(copy_id,target,source.name,source.variant,source.category,source.notes,source.msrp_cents,source.msrp_source_url,
          source.offers,source.image_url,source.image_source_url,source.image_mode,source.priority,source.gift_preferences,'active')
        returning * into saved;
      end if;
    end if;
    return next saved;
  end loop;
end;
$$;
revoke all on function private.transfer_wishes(uuid,text,jsonb) from public,anon;
grant execute on function private.transfer_wishes(uuid,text,jsonb) to authenticated;
create function public.transfer_wishes(target uuid, mode text, entries jsonb)
returns setof public.wish_items language sql security invoker set search_path = '' as $$
  select * from private.transfer_wishes(target,mode,entries);
$$;
revoke all on function public.transfer_wishes(uuid,text,jsonb) from public,anon;
grant execute on function public.transfer_wishes(uuid,text,jsonb) to authenticated;

-- Received and archived wishes keep their observations, but no longer run daily checks.
create or replace function public.claim_price_check(target uuid, cutoff timestamptz)
returns setof public.wish_items language sql security invoker set search_path = '' as $$
  update public.wish_items set last_attempt_at=now()
  where id=target and status='active' and (last_attempt_at is null or last_attempt_at<cutoff)
  returning *;
$$;
commit;
