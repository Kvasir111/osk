-- Additive upgrade: run once after features.sql. Existing lists and sharing stay unchanged.
begin;
create table public.santa_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  budget_cents integer check (budget_cents between 1 and 100000000),
  exchange_date date,
  exclusions jsonb not null default '[]' check (jsonb_typeof(exclusions) = 'array' and jsonb_array_length(exclusions) <= 200),
  drawn_at timestamptz,
  created_at timestamptz not null default now()
);
create index santa_events_family_idx on public.santa_events(family_id);
create table public.santa_participants (
  event_id uuid not null references public.santa_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key(event_id,user_id)
);
create index santa_participants_user_idx on public.santa_participants(user_id);
create table public.santa_assignments (
  event_id uuid not null references public.santa_events(id) on delete cascade,
  giver_id uuid not null,
  recipient_id uuid not null,
  primary key(event_id,giver_id),
  unique(event_id,recipient_id),
  check(giver_id <> recipient_id),
  foreign key(event_id,giver_id) references public.santa_participants(event_id,user_id) on delete cascade,
  foreign key(event_id,recipient_id) references public.santa_participants(event_id,user_id) on delete cascade
);
create index santa_assignments_giver_idx on public.santa_assignments(giver_id);
alter table public.santa_events enable row level security;
alter table public.santa_participants enable row level security;
alter table public.santa_assignments enable row level security;
revoke all on public.santa_events,public.santa_participants,public.santa_assignments from public,anon,authenticated;
grant select on public.santa_events,public.santa_participants,public.santa_assignments to authenticated;
grant all on public.santa_events,public.santa_participants,public.santa_assignments to service_role;
create policy santa_events_read on public.santa_events for select to authenticated using (private.in_family(family_id));
create policy santa_participants_read on public.santa_participants for select to authenticated
  using (exists(select 1 from public.santa_events e where e.id=event_id));
-- No organizer override: even the organizer can read only their own recipient.
create policy santa_assignments_read on public.santa_assignments for select to authenticated
  using (giver_id=(select auth.uid()) and exists(select 1 from public.santa_events e where e.id=event_id));

-- Service-only, invoker-rights transaction. The API supplies its verified caller ID.
-- A shared event lock serializes edits, opt-ins, and drawing; all writes recheck membership.
create function public.mutate_santa(actor uuid, target uuid, operation text, input jsonb default '{}')
returns uuid language plpgsql security invoker set search_path='' as $$
declare
  f public.families;
  e public.santa_events;
  member_id uuid;
  pair jsonb;
  n integer;
  result_id uuid;
begin
  if actor is null then raise exception 'Sign in required'; end if;
  if operation='create' then
    select * into f from public.families where id=target for update;
  else
    select * into e from public.santa_events where id=target for update;
    select * into f from public.families where id=e.family_id for update;
  end if;
  if f.id is null or (f.owner_id<>actor and not exists(select 1 from public.family_members where family_id=f.id and user_id=actor)) then
    raise exception 'Family access required';
  end if;
  if operation in ('create','update','draw','delete') and f.owner_id<>actor then raise exception 'Organizer access required'; end if;
  if operation='delete' then delete from public.santa_events where id=target; return target; end if;
  if e.drawn_at is not null then raise exception 'This draw is locked'; end if;
  if operation in ('create','update') then
    for pair in select value from jsonb_array_elements(coalesce(input->'exclusions','[]')) loop
      if jsonb_typeof(pair)<>'array' or jsonb_array_length(pair)<>2 or pair->>0=pair->>1 then raise exception 'Invalid exclusion'; end if;
      for member_id in select value::uuid from jsonb_array_elements_text(pair) loop
        if member_id<>f.owner_id and not exists(select 1 from public.family_members where family_id=f.id and user_id=member_id) then raise exception 'Exclusions must name family members'; end if;
      end loop;
    end loop;
    if operation='create' then
      insert into public.santa_events(family_id,name,budget_cents,exchange_date,exclusions)
      values(f.id,input->>'name',(input->>'budget_cents')::integer,(input->>'exchange_date')::date,coalesce(input->'exclusions','[]')) returning id into result_id;
      return result_id;
    end if;
    update public.santa_events set name=input->>'name',budget_cents=(input->>'budget_cents')::integer,
      exchange_date=(input->>'exchange_date')::date,exclusions=coalesce(input->'exclusions','[]') where id=target;
  elsif operation='join' then
    if (select count(*) from public.santa_participants where event_id=target)>=50 then raise exception 'Maximum 50 participants'; end if;
    insert into public.santa_participants values(target,actor) on conflict do nothing;
  elsif operation='leave' then
    delete from public.santa_participants where event_id=target and user_id=actor;
  elsif operation='draw' then
    select count(*) into n from public.santa_participants where event_id=target;
    if n<3 or n>50 or jsonb_array_length(input->'assignments')<>n then raise exception 'At least three participants and a complete draw are required'; end if;
    if exists(select 1 from public.santa_participants p where p.event_id=target and p.user_id<>f.owner_id
      and not exists(select 1 from public.family_members m where m.family_id=f.id and m.user_id=p.user_id)) then raise exception 'A participant has left the family. Start a new event'; end if;
    insert into public.santa_assignments(event_id,giver_id,recipient_id)
      select target,(value->>'giver_id')::uuid,(value->>'recipient_id')::uuid from jsonb_array_elements(input->'assignments');
    if (select count(*) from public.santa_assignments where event_id=target)<>n then raise exception 'Incomplete draw'; end if;
    if exists(select 1 from public.santa_assignments a cross join lateral jsonb_array_elements(e.exclusions) x
      where a.event_id=target and ((a.giver_id=(x.value->>0)::uuid and a.recipient_id=(x.value->>1)::uuid)
      or (a.giver_id=(x.value->>1)::uuid and a.recipient_id=(x.value->>0)::uuid))) then raise exception 'Draw violates an exclusion'; end if;
    update public.santa_events set drawn_at=now() where id=target;
  else raise exception 'Unknown action';
  end if;
  return target;
end $$;
revoke all on function public.mutate_santa(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.mutate_santa(uuid,uuid,text,jsonb) to service_role;
commit;
