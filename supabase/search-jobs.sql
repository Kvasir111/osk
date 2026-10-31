-- Run once AFTER schema.sql and features.sql, in Supabase SQL Editor.
-- Durable research jobs survive closing the product dialog or navigating away.
begin;
create table public.product_search_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null check (length(query) between 3 and 5000),
  product_url text,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  stages jsonb not null default '[]' check (jsonb_typeof(stages)='array'),
  result jsonb,
  error_message text,
  approved_item_id uuid references public.wish_items(id) on delete set null,
  approved_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index product_search_jobs_user_created_idx on public.product_search_jobs(user_id,created_at desc);
create index product_search_jobs_approved_item_idx on public.product_search_jobs(approved_item_id);
alter table public.product_search_jobs enable row level security;
revoke all on public.product_search_jobs from anon,authenticated;
grant select on public.product_search_jobs to authenticated;
grant all on public.product_search_jobs to service_role;
create policy search_jobs_read on public.product_search_jobs for select to authenticated
  using ((select auth.uid())=user_id);
-- Only the server can reserve work, attach approved items, or save research evidence.
commit;
