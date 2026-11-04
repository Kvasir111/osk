-- Apply once after wishlist-usability.sql. No existing prices produce alerts during setup.
begin;
create table public.price_watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.wish_items(id) on delete cascade,
  target_cents integer not null check (target_cents between 1 and 100000000),
  is_met boolean not null default false,
  last_price_cents integer,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,item_id)
);
create index price_watches_item_idx on public.price_watches(item_id);
create table public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  watch_id uuid not null references public.price_watches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.wish_items(id) on delete cascade,
  name text not null,
  variant text not null,
  price_cents integer not null check (price_cents between 1 and 100000000),
  target_cents integer not null check (target_cents between 1 and 100000000),
  offer jsonb not null check (jsonb_typeof(offer)='object'),
  observed_at timestamptz not null,
  read_at timestamptz,
  unique(watch_id,observed_at)
);
create index price_alerts_user_time_idx on public.price_alerts(user_id,observed_at desc);
create index price_alerts_unread_idx on public.price_alerts(user_id) where read_at is null;
create index price_alerts_item_idx on public.price_alerts(item_id);
alter table public.price_watches enable row level security;
alter table public.price_alerts enable row level security;
revoke all on public.price_watches,public.price_alerts from public,anon,authenticated;
grant select,delete on public.price_watches to authenticated;
grant insert(user_id,item_id,target_cents),update(target_cents) on public.price_watches to authenticated;
grant select,update(read_at) on public.price_alerts to authenticated;
grant all on public.price_watches,public.price_alerts to service_role;
create policy watches_read on public.price_watches for select to authenticated
  using (user_id=(select auth.uid()) and exists(select 1 from public.wish_items i where i.id=item_id));
create policy watches_insert on public.price_watches for insert to authenticated
  with check (user_id=(select auth.uid()) and exists(select 1 from public.wish_items i where i.id=item_id and i.status='active'));
create policy watches_update on public.price_watches for update to authenticated
  using (user_id=(select auth.uid()) and exists(select 1 from public.wish_items i where i.id=item_id))
  with check (user_id=(select auth.uid()) and exists(select 1 from public.wish_items i where i.id=item_id and i.status='active'));
create policy watches_delete on public.price_watches for delete to authenticated using (user_id=(select auth.uid()));
create policy alerts_read on public.price_alerts for select to authenticated
  using (user_id=(select auth.uid()) and exists(select 1 from public.wish_items i
    where i.id=item_id and i.status='active' and i.name=price_alerts.name and i.variant=price_alerts.variant));
create policy alerts_update on public.price_alerts for update to authenticated
  using (user_id=(select auth.uid()) and exists(select 1 from public.wish_items i
    where i.id=item_id and i.status='active' and i.name=price_alerts.name and i.variant=price_alerts.variant))
  with check (user_id=(select auth.uid()));

-- Reset only when the threshold actually changes. Same-value retries preserve state.
create function private.reset_price_target() returns trigger language plpgsql set search_path='' as $$
begin
  if new.target_cents is distinct from old.target_cents then
    new.is_met:=false; new.last_price_cents:=null; new.last_checked_at:=null; new.updated_at:=now();
  end if;
  return new;
end;
$$;
revoke all on function private.reset_price_target() from public,anon,authenticated,service_role;
create trigger reset_price_target before update on public.price_watches for each row execute function private.reset_price_target();
create function public.set_price_target(target_item uuid, price integer)
returns setof public.price_watches language sql security invoker set search_path='' as $$
  insert into public.price_watches(user_id,item_id,target_cents) values(auth.uid(),target_item,price)
  on conflict(user_id,item_id) do update set target_cents=excluded.target_cents returning *;
$$;
revoke all on function public.set_price_target(uuid,integer) from public,anon;
grant execute on function public.set_price_target(uuid,integer) to authenticated;

-- Workers do not have a caller UID. This private, uncallable helper mirrors list/family
-- read access using the watch's account ID, never editable profile metadata.
create function private.price_watch_access(actor uuid, target uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.wish_lists l where l.id=target and (
    l.owner_id=actor or exists(select 1 from public.list_members m where m.list_id=l.id and m.user_id=actor)
    or exists(select 1 from public.family_lists fl join public.families f on f.id=fl.family_id
      where fl.list_id=l.id and (f.owner_id=actor or exists(select 1 from public.family_members m where m.family_id=f.id and m.user_id=actor))
      and (l.owner_id=f.owner_id or exists(select 1 from public.family_members m where m.family_id=f.id and m.user_id=l.owner_id)))
  ));
$$;
revoke all on function private.price_watch_access(uuid,uuid) from public,anon,authenticated,service_role;

-- Price writes and notifications commit together. Only a service-role price observation
-- can notify: browser/manual writes, image edits, failures, and archived items cannot.
create function private.notify_price_targets() returns trigger
language plpgsql security definer set search_path='' as $$
declare watch public.price_watches; cheapest jsonb; amount integer; met boolean;
begin
  if new.name is distinct from old.name or new.variant is distinct from old.variant then
    update public.price_watches set is_met=false,last_price_cents=null,last_checked_at=null where item_id=new.id;
  end if;
  if current_setting('role',true)<>'service_role' or new.status<>'active' or new.refresh_status<>'ok'
     or new.checked_at is null or new.checked_at is not distinct from old.checked_at then return new; end if;
  select o into cheapest from jsonb_array_elements(new.offers) o
    where case when (o->>'price_cents') ~ '^[0-9]{1,9}$' then (o->>'price_cents')::integer else 0 end between 1 and 100000000
      and o->>'availability' in ('in_stock','unknown') and o->>'url' like 'https://%'
    order by (o->>'price_cents')::integer,o->>'url' limit 1;
  if cheapest is null then return new; end if;
  amount:=(cheapest->>'price_cents')::integer;
  for watch in select * from public.price_watches where item_id=new.id order by id for update loop
    if not private.price_watch_access(watch.user_id,new.list_id) then continue; end if;
    met:=amount<=watch.target_cents;
    if met and not watch.is_met then
      insert into public.price_alerts(watch_id,user_id,item_id,name,variant,price_cents,target_cents,offer,observed_at)
      values(watch.id,watch.user_id,new.id,new.name,new.variant,amount,watch.target_cents,cheapest,new.checked_at)
      on conflict(watch_id,observed_at) do nothing;
    end if;
    update public.price_watches set is_met=met,last_price_cents=amount,last_checked_at=new.checked_at where id=watch.id;
  end loop;
  return new;
end;
$$;
revoke all on function private.notify_price_targets() from public,anon,authenticated,service_role;
create trigger notify_price_targets after update on public.wish_items for each row execute function private.notify_price_targets();
commit;
