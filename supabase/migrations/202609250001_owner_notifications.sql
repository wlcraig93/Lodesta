-- Owner notifications: durable, deduplicated delivery records. The inbox and
-- run records stay the source of truth; a notification only reports them.
-- Recipients are resolved at delivery time from sites.owner_user_id, never
-- from business contact data.
create table public.owner_notifications (
  id text primary key,
  site_id text not null references public.sites(id) on delete cascade,
  kind text not null check (kind in ('lead', 'run_ready', 'run_failed', 'run_needs_input', 'domain_attention')),
  subject_id text not null,
  dedupe_key text not null unique,
  audience text not null check (audience in ('owner', 'operator')),
  test boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'suppressed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  claimed_by text,
  claimed_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 2000),
  suppressed_reason text check (suppressed_reason is null or length(suppressed_reason) <= 200),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index owner_notifications_due_idx on public.owner_notifications (next_attempt_at)
  where status in ('pending', 'sending');
create index owner_notifications_site_idx on public.owner_notifications (site_id, created_at desc);

-- Claims due notifications for one worker. A 'sending' claim older than five
-- minutes is treated as abandoned so a crashed worker never strands a lead.
create or replace function public.claim_owner_notifications(
  target_worker_id text,
  target_limit integer,
  target_now timestamptz
)
returns setof public.owner_notifications
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select id from public.owner_notifications
    where (status = 'pending' and next_attempt_at <= target_now)
       or (status = 'sending' and claimed_at < target_now - interval '5 minutes')
    order by next_attempt_at, id
    limit greatest(1, least(target_limit, 50))
    for update skip locked
  )
  update public.owner_notifications notification
  set status = 'sending',
      claimed_by = target_worker_id,
      claimed_at = target_now,
      attempts = notification.attempts + 1,
      updated_at = target_now
  from due
  where notification.id = due.id
  returning notification.*;
end;
$$;

alter table public.owner_notifications enable row level security;

revoke all on table public.owner_notifications from public, anon, authenticated;
revoke all on function public.claim_owner_notifications(text, integer, timestamptz) from public, anon, authenticated;

grant all on table public.owner_notifications to service_role;
grant execute on function public.claim_owner_notifications(text, integer, timestamptz) to service_role;
