-- Separate generated candidate artifacts from durable managed sites.

create table if not exists site_generations (
  id text primary key,
  agent_run_id text references agent_runs(id) on delete set null,
  source_url text,
  source_host text,
  business_name text not null,
  vertical text not null,
  candidate_slug text not null,
  bundle_json jsonb not null,
  status text not null default 'ready' check (status in ('ready', 'blocked', 'promoted', 'archived')),
  created_site_id text references sites(id) on delete set null,
  promoted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists site_generations_status_created_idx on site_generations(status, created_at desc);
create index if not exists site_generations_source_host_idx on site_generations(source_host);
create index if not exists site_generations_agent_run_idx on site_generations(agent_run_id);
create index if not exists site_generations_created_site_idx on site_generations(created_site_id);

alter table site_generations enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on site_generations to service_role;
