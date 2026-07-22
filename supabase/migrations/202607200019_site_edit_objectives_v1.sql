create table site_edit_objectives_v1 (
  id text primary key,
  run_id text not null unique references site_agent_runs_v2(id) on delete cascade,
  session_id text not null references site_agent_sessions(id) on delete cascade,
  site_id text not null references sites(id) on delete cascade,
  request_id text not null,
  schema_version text not null check (schema_version = 'site-edit-objective-v1'),
  objective jsonb not null,
  created_at timestamptz not null
);
create index site_edit_objectives_v1_site_idx on site_edit_objectives_v1(site_id, created_at desc);
alter table site_edit_objectives_v1 enable row level security;
grant select, insert on site_edit_objectives_v1 to service_role;
