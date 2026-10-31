-- Bootstrap a NEW, dedicated Supabase project with this file in SQL Editor.
-- This is the initial schema, not an applied migration.
-- Then run features.sql, search-jobs.sql, and item-pictures.sql for the full application.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.wish_lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  description text not null default '' check (length(description) <= 500),
  occasion text not null default 'everyday' check (occasion in ('everyday','christmas','birthday','other')),
  share_token uuid unique,
  created_at timestamptz not null default now()
);
create index wish_lists_owner_idx on public.wish_lists(owner_id);

create table public.list_members (
  list_id uuid not null references public.wish_lists(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('viewer','editor')),
  primary key (list_id, user_id)
);
create index list_members_user_idx on public.list_members(user_id);

create table public.wish_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.wish_lists(id) on delete cascade,
  name text not null check (length(name) between 1 and 200),
  variant text not null default '' check (length(variant) <= 200),
  category text not null default 'Other' check (length(category) <= 50),
  notes text not null default '' check (length(notes) <= 2000),
  msrp_cents integer check (msrp_cents > 0 and msrp_cents <= 100000000),
  msrp_source_url text,
  offers jsonb not null default '[]' check (jsonb_typeof(offers) = 'array' and jsonb_array_length(offers) <= 10),
  checked_at timestamptz,
  last_attempt_at timestamptz,
  refresh_status text not null default 'never' check (refresh_status in ('never','ok','failed')),
  created_at timestamptz not null default now(),
  check (msrp_cents is null or msrp_source_url is not null)
);
create index wish_items_list_idx on public.wish_items(list_id);
create index wish_items_due_idx on public.wish_items(last_attempt_at);

create table public.list_invites (
  token uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.wish_lists(id) on delete cascade,
  role text not null check (role in ('viewer','editor')),
  expires_at timestamptz not null default (now() + interval '7 days')
);
create index list_invites_list_idx on public.list_invites(list_id);

create table public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  requests integer not null default 0,
  primary key (user_id, day)
);

-- Non-exposed helpers prevent recursive membership policies. No user ID argument:
-- the caller's verified identity is always read from auth.uid().
create function private.can_access_list(target uuid, editing boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    exists (select 1 from public.wish_lists l where l.id = target and l.owner_id = auth.uid())
    or exists (select 1 from public.list_members m where m.list_id = target
      and m.user_id = auth.uid() and (not editing or m.role = 'editor'))
  );
$$;
create function private.owns_list(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.wish_lists l where l.id = target and l.owner_id = auth.uid()
  );
$$;
revoke all on function private.can_access_list(uuid,boolean), private.owns_list(uuid) from public, anon;
grant execute on function private.can_access_list(uuid,boolean), private.owns_list(uuid) to authenticated;

alter table public.wish_lists enable row level security;
alter table public.list_members enable row level security;
alter table public.wish_items enable row level security;
alter table public.list_invites enable row level security;
alter table public.ai_usage enable row level security;
revoke all on public.wish_lists, public.list_members, public.wish_items, public.list_invites, public.ai_usage from anon, authenticated;
grant select, insert, delete on public.wish_lists to authenticated;
grant update (name,description,occasion) on public.wish_lists to authenticated;
grant select on public.list_members to authenticated;
grant select, insert, delete on public.wish_items to authenticated;
grant update (name,variant,category,notes,msrp_cents,msrp_source_url,offers,checked_at,last_attempt_at,refresh_status) on public.wish_items to authenticated;
grant all on public.wish_lists, public.list_members, public.wish_items, public.list_invites, public.ai_usage to service_role;

create policy lists_read on public.wish_lists for select to authenticated
  using ((select auth.uid()) = owner_id or private.can_access_list(id));
create policy lists_insert on public.wish_lists for insert to authenticated
  with check ((select auth.uid()) = owner_id and share_token is null);
create policy lists_update on public.wish_lists for update to authenticated
  using (private.owns_list(id)) with check ((select auth.uid()) = owner_id);
create policy lists_delete on public.wish_lists for delete to authenticated
  using (private.owns_list(id));
create policy members_read on public.list_members for select to authenticated
  using (private.can_access_list(list_id));
create policy items_read on public.wish_items for select to authenticated
  using (private.can_access_list(list_id));
create policy items_insert on public.wish_items for insert to authenticated
  with check (private.can_access_list(list_id,true));
create policy items_update on public.wish_items for update to authenticated
  using (private.can_access_list(list_id,true)) with check (private.can_access_list(list_id,true));
create policy items_delete on public.wish_items for delete to authenticated
  using (private.can_access_list(list_id,true));

-- Service-only atomic counters cap interactive searches at 20/user/UTC day.
create function public.reserve_ai_request(target_user uuid) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare reserved integer;
begin
  insert into public.ai_usage(user_id,day,requests) values(target_user,(now() at time zone 'UTC')::date,1)
  on conflict (user_id,day) do update set requests = public.ai_usage.requests + 1
    where public.ai_usage.requests < 20
  returning requests into reserved;
  return reserved is not null;
end;
$$;
revoke all on function public.reserve_ai_request(uuid) from public, anon, authenticated;
grant execute on function public.reserve_ai_request(uuid) to service_role;

-- A compare-and-set lease prevents duplicate checks across concurrent workers.
create function public.claim_price_check(target uuid, cutoff timestamptz)
returns setof public.wish_items language sql security invoker set search_path = '' as $$
  update public.wish_items set last_attempt_at = now()
  where id = target and (last_attempt_at is null or last_attempt_at < cutoff)
  returning *;
$$;
revoke all on function public.claim_price_check(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.claim_price_check(uuid,timestamptz) to service_role;
commit;
