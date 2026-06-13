-- Public presence-report funnel MVP.

create table if not exists prospect_reports (
  id text primary key,
  place_id text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  job_id text,
  source_url text,
  source_host text,
  website_kind text not null default 'no_website' check (website_kind in ('owned_website', 'no_website', 'social_or_aggregator')),
  report_json jsonb,
  unlocked_at timestamptz,
  lead_id text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists prospect_report_leads (
  id text primary key,
  report_id text not null references prospect_reports(id) on delete cascade,
  email text not null,
  contact_name text,
  phone text,
  ip_hash text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists prospect_reports_place_completed_idx on prospect_reports(place_id, completed_at desc)
  where status = 'completed';

create unique index if not exists prospect_reports_one_active_place_idx on prospect_reports(place_id)
  where status in ('queued', 'running');

create index if not exists prospect_report_leads_report_idx on prospect_report_leads(report_id, created_at desc);

alter table prospect_reports enable row level security;
alter table prospect_report_leads enable row level security;
