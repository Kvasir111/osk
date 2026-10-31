-- Add to an EXISTING Ósk project in Supabase SQL Editor. Run once.
-- Preserves existing lists and seeds history only from their currently saved prices.
begin;
alter table public.wish_items add column price_check_details jsonb not null default '{}'::jsonb
  check (jsonb_typeof(price_check_details) = 'object');
-- Diagnostics travel with an approved search result and are replaced by server refreshes.

create table public.price_observations (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.wish_items(id) on delete cascade,
  name text not null,
  variant text not null,
  observed_at timestamptz not null default now(),
  source text not null check (source in ('search','manual')),
  offers jsonb not null check (jsonb_typeof(offers) = 'array'),
  msrp_cents integer
);
create index price_observations_item_time_idx on public.price_observations(item_id, observed_at desc);
alter table public.price_observations enable row level security;
revoke all on public.price_observations from anon, authenticated;
grant select on public.price_observations to authenticated;
grant all on public.price_observations to service_role;
create policy history_read on public.price_observations for select to authenticated
  using (exists (select 1 from public.wish_items i where i.id = item_id));

-- Snapshots and the item write commit together. Failed checks never create prices.
-- This narrowly scoped trigger needs elevated access to the append-only history table.
create function private.record_price_observation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.offers is not distinct from old.offers
      and new.checked_at is not distinct from old.checked_at
      and new.name = old.name and new.variant = old.variant then return new; end if;
  end if;
  if jsonb_array_length(new.offers) > 0 then
    insert into public.price_observations(item_id,name,variant,source,offers,msrp_cents)
    values(new.id,new.name,new.variant,case when new.checked_at is null then 'manual' else 'search' end,new.offers,new.msrp_cents);
  end if;
  return new;
end;
$$;
revoke all on function private.record_price_observation() from public,anon,authenticated,service_role;
create trigger record_price_observation after insert or update on public.wish_items
  for each row execute function private.record_price_observation();
insert into public.price_observations(item_id,name,variant,observed_at,source,offers,msrp_cents)
select id,name,variant,coalesce(checked_at,created_at),case when checked_at is null then 'manual' else 'search' end,offers,msrp_cents
from public.wish_items where jsonb_array_length(offers) > 0;

create table public.families (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  created_at timestamptz not null default now()
);
create index families_owner_idx on public.families(owner_id);
create table public.family_members (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key(family_id,user_id)
);
create index family_members_user_idx on public.family_members(user_id);
create table public.family_lists (
  family_id uuid not null references public.families(id) on delete cascade,
  list_id uuid not null references public.wish_lists(id) on delete cascade,
  primary key(family_id,list_id)
);
create index family_lists_list_idx on public.family_lists(list_id);
create table public.family_invites (
  token uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days')
);
create index family_invites_family_idx on public.family_invites(family_id);

-- All membership lookup helpers are internal, identity-bound, and avoid recursive RLS.
create function private.in_family(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    exists(select 1 from public.families f where f.id=target and f.owner_id=auth.uid())
    or exists(select 1 from public.family_members m where m.family_id=target and m.user_id=auth.uid())
  );
$$;
create function private.family_access_list(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.family_lists fl
    join public.families f on f.id=fl.family_id
    join public.wish_lists l on l.id=fl.list_id
    where fl.list_id=target
      and private.in_family(fl.family_id)
      and (l.owner_id=f.owner_id or exists(select 1 from public.family_members m
        where m.family_id=f.id and m.user_id=l.owner_id))
  );
$$;
revoke all on function private.in_family(uuid), private.family_access_list(uuid) from public,anon;
grant execute on function private.in_family(uuid), private.family_access_list(uuid) to authenticated;
create or replace function private.can_access_list(target uuid, editing boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    exists (select 1 from public.wish_lists l where l.id=target and l.owner_id=auth.uid())
    or exists (select 1 from public.list_members m where m.list_id=target
      and m.user_id=auth.uid() and (not editing or m.role='editor'))
    or (not editing and private.family_access_list(target))
  );
$$;
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.family_lists enable row level security;
alter table public.family_invites enable row level security;
revoke all on public.families,public.family_members,public.family_lists,public.family_invites from anon,authenticated;
grant select,insert,delete on public.families to authenticated;
grant update(name) on public.families to authenticated;
grant select on public.family_members to authenticated;
grant select,insert,delete on public.family_lists to authenticated;
grant all on public.families,public.family_members,public.family_lists,public.family_invites to service_role;
create policy families_read on public.families for select to authenticated using ((select auth.uid())=owner_id or private.in_family(id));
create policy families_insert on public.families for insert to authenticated with check ((select auth.uid())=owner_id);
create policy families_update on public.families for update to authenticated
  using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy families_delete on public.families for delete to authenticated using ((select auth.uid())=owner_id);
create policy family_members_read on public.family_members for select to authenticated using (private.in_family(family_id));
create policy family_lists_read on public.family_lists for select to authenticated using (private.in_family(family_id));
create policy family_lists_insert on public.family_lists for insert to authenticated
  with check (private.in_family(family_id) and private.owns_list(list_id));
create policy family_lists_delete on public.family_lists for delete to authenticated
  using (private.owns_list(list_id) or exists(select 1 from public.families f
    where f.id=family_id and f.owner_id=(select auth.uid())));
commit;
