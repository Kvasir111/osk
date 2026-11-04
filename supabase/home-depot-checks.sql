-- Run once after tracking-alerts.sql. Provider jobs and quotas are server-only.
begin;
create table public.home_depot_usage (
  month date primary key,
  requests integer not null default 0 check (requests >= 0)
);
create table public.home_depot_checks (
  id uuid primary key default gen_random_uuid(),
  product_id text not null check (product_id ~ '^[0-9]{9}$'),
  zipcode text not null check (zipcode ~ '^[0-9]{5}$'),
  day date not null,
  snapshot_id text,
  result jsonb,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (product_id, zipcode, day)
);
alter table public.home_depot_usage enable row level security;
alter table public.home_depot_checks enable row level security;
revoke all on public.home_depot_usage, public.home_depot_checks from public, anon, authenticated;
grant select, insert, update on public.home_depot_usage, public.home_depot_checks to service_role;

-- A reservation is charged conservatively even if the trigger times out. Never
-- retry an uncertain trigger: it may already have started a billable job.
create function public.reserve_home_depot_check(product text, zip text, monthly_limit integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  today date := (now() at time zone 'UTC')::date;
  current_month date := date_trunc('month', now() at time zone 'UTC')::date;
  job public.home_depot_checks;
  spent integer;
begin
  if product !~ '^[0-9]{9}$' or zip !~ '^[0-9]{5}$' or monthly_limit is null or monthly_limit < 1 then
    raise exception 'Invalid Home Depot reservation';
  end if;
  -- All callers share one monthly lock, including concurrent serverless workers.
  perform pg_catalog.pg_advisory_xact_lock(71463382);
  select * into job from public.home_depot_checks
    where product_id=product and zipcode=zip and day=today;
  if found then
    return jsonb_build_object('job',to_jsonb(job),'start',false);
  end if;
  insert into public.home_depot_usage(month) values(current_month) on conflict do nothing;
  select requests into spent from public.home_depot_usage where month=current_month;
  if spent >= least(monthly_limit,4000) then return null; end if;
  update public.home_depot_usage set requests=requests+1 where month=current_month;
  insert into public.home_depot_checks(product_id,zipcode,day) values(product,zip,today) returning * into job;
  return jsonb_build_object('job',to_jsonb(job),'start',true);
end;
$$;
revoke all on function public.reserve_home_depot_check(text,text,integer) from public,anon,authenticated;
grant execute on function public.reserve_home_depot_check(text,text,integer) to service_role;
commit;
