-- Production monitoring of published sites. Each probe result is a
-- regenerable operational record; the worker alerts an operator when the
-- latest two checks of one kind fail for a site.
create table public.site_monitor_checks (
  id text primary key,
  site_id text not null references public.sites(id) on delete cascade,
  kind text not null check (kind in ('site', 'form')),
  target text not null check (length(target) <= 500),
  ok boolean not null,
  detail jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now()
);

create index site_monitor_checks_recent_idx on public.site_monitor_checks (site_id, kind, checked_at desc);

alter table public.site_monitor_checks enable row level security;
revoke all on table public.site_monitor_checks from public, anon, authenticated;
grant all on table public.site_monitor_checks to service_role;

-- Operator alerts reuse the durable notification path.
alter table public.owner_notifications drop constraint owner_notifications_kind_check;
alter table public.owner_notifications add constraint owner_notifications_kind_check
  check (kind in ('lead', 'run_ready', 'run_failed', 'run_needs_input', 'domain_attention', 'site_unreachable', 'form_unreachable'));
