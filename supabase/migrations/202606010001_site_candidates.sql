-- Separate generated candidate artifacts from durable managed sites.

create table if not exists site_candidates (
  id text primary key,
  agent_run_id text references agent_runs(id) on delete set null,
  source_url text,
  source_host text,
  business_name text not null,
  vertical text not null,
  candidate_slug text not null,
  bundle_json jsonb not null,
  status text not null default 'ready' check (status in ('ready', 'blocked', 'accepted', 'archived')),
  intended_site_id text references sites(id) on delete set null,
  accepted_site_id text references sites(id) on delete set null,
  accepted_version_id text,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists site_candidates_status_created_idx on site_candidates(status, created_at desc);
create index if not exists site_candidates_source_host_idx on site_candidates(source_host);
create index if not exists site_candidates_agent_run_idx on site_candidates(agent_run_id);
create index if not exists site_candidates_accepted_site_idx on site_candidates(accepted_site_id);

alter table site_candidates enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on site_candidates to service_role;
