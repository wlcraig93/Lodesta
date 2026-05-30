-- Lodesta Agent Telemetry V1
-- Additive migration for internal site-generation run telemetry.

create table if not exists agent_runs (
  id text primary key,
  run_type text not null,
  agent_type text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'canceled')),
  actor_type text,
  actor_id text,
  source text not null check (source in ('admin_console', 'api', 'job')),
  source_url text,
  source_host text,
  target_type text,
  target_id text,
  input_summary text,
  output_summary text,
  input_json jsonb,
  output_json jsonb,
  metadata jsonb not null default '{}',
  tags text[] not null default '{}',
  notes text,
  error_code text,
  error_message text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agent_run_spans (
  id text primary key,
  run_id text not null references agent_runs(id) on delete cascade,
  parent_span_id text references agent_run_spans(id) on delete set null,
  span_type text not null,
  name text not null,
  status text not null default 'running' check (status in ('queued', 'running', 'completed', 'failed', 'canceled')),
  input_json jsonb,
  output_json jsonb,
  metadata jsonb not null default '{}',
  artifact_refs jsonb not null default '{}',
  error_message text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_ms int
);

create table if not exists agent_model_calls (
  id text primary key,
  run_id text not null references agent_runs(id) on delete cascade,
  span_id text references agent_run_spans(id) on delete set null,
  provider text not null,
  model text not null,
  endpoint text not null,
  operation text not null,
  status text not null default 'running' check (status in ('queued', 'running', 'completed', 'failed', 'canceled')),
  request_json jsonb,
  response_json jsonb,
  usage_json jsonb,
  input_tokens int,
  output_tokens int,
  cache_creation_tokens int,
  cache_read_tokens int,
  error_message text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_ms int
);

create index if not exists agent_runs_created_at_idx on agent_runs(created_at);
create index if not exists agent_runs_source_host_idx on agent_runs(source_host);
create index if not exists agent_runs_target_idx on agent_runs(target_type, target_id);
create index if not exists agent_runs_type_status_created_idx on agent_runs(run_type, status, created_at);
create index if not exists agent_run_spans_run_started_idx on agent_run_spans(run_id, started_at);
create index if not exists agent_model_calls_run_idx on agent_model_calls(run_id);
create index if not exists agent_model_calls_span_idx on agent_model_calls(span_id);

alter table agent_runs enable row level security;
alter table agent_run_spans enable row level security;
alter table agent_model_calls enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on agent_runs to service_role;
grant select, insert, update, delete on agent_run_spans to service_role;
grant select, insert, update, delete on agent_model_calls to service_role;
