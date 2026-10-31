-- Run once after schema.sql and the existing feature upgrades.
begin;
create table public.account_invitations (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('email','code')),
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  recipient_email text check (length(recipient_email) between 3 and 254 and recipient_email = lower(recipient_email)),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  revoked_at timestamptz,
  last_attempt_at timestamptz,
  delivery_attempts integer not null default 0 check (delivery_attempts between 0 and 5),
  delivery_status text not null default 'pending' check (delivery_status in ('pending','sent','failed')),
  sent_at timestamptz,
  check (kind <> 'email' or recipient_email is not null)
);
create index account_invitations_creator_idx on public.account_invitations(created_by,created_at desc);
alter table public.account_invitations enable row level security;
-- All access goes through server-verified admin authorization. No client policies.
revoke all on public.account_invitations from public,anon,authenticated;
grant all on public.account_invitations to service_role;

create function public.create_account_invitation(actor uuid, invite_kind text, token_hash text, email_address text)
returns setof public.account_invitations language plpgsql security invoker set search_path = '' as $$
begin
  -- Serialize each administrator's quota, including concurrent requests.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 0));
  if (select count(*) from public.account_invitations where created_by = actor and created_at >= now() - interval '24 hours') >= 20 then
    raise exception 'Invitation quota reached' using errcode = 'P0001';
  end if;
  return query insert into public.account_invitations(created_by,kind,code_hash,recipient_email)
    values(actor,invite_kind,token_hash,email_address) returning *;
end;
$$;

create function public.reserve_account_invitation(target_id uuid, email_address text)
returns boolean language sql security invoker set search_path = '' as $$
  with reserved as (
    update public.account_invitations
      set recipient_email = email_address, last_attempt_at = now(),
          delivery_attempts = delivery_attempts + 1, delivery_status = 'pending'
      where id = target_id and revoked_at is null and expires_at > now()
        and email_address = lower(email_address) and length(email_address) between 3 and 254
        and (recipient_email is null or recipient_email = email_address)
        and delivery_attempts < 5
        and (last_attempt_at is null or last_attempt_at < now() - interval '60 seconds')
      returning id
  ) select exists(select 1 from reserved);
$$;
revoke all on function public.create_account_invitation(uuid,text,text,text), public.reserve_account_invitation(uuid,text) from public,anon,authenticated;
grant execute on function public.create_account_invitation(uuid,text,text,text), public.reserve_account_invitation(uuid,text) to service_role;
commit;
