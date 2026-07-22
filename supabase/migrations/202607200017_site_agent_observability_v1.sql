-- Clean-break run V2 plus hierarchical private observability.

do $$
begin
  if exists (select 1 from site_agent_runs_v1) then
    raise exception 'site-agent-run-v2 cutover requires explicit pre-launch run cleanup';
  end if;
end;
$$;

alter table site_agent_runs_v1 rename to site_agent_runs_v2;
alter table site_agent_runs_v2 drop constraint if exists site_agent_runs_v1_schema_version_check;
alter table site_agent_runs_v2 add constraint site_agent_runs_v2_schema_version_check check (schema_version = 'site-agent-run-v2');
alter index if exists site_agent_runs_v1_session_idx rename to site_agent_runs_v2_session_idx;

drop function if exists claim_site_agent_run_v1(text);
create or replace function claim_site_agent_run_v2(target_run_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target site_agent_runs_v2%rowtype;
  claimed jsonb;
  now_value timestamptz := now();
begin
  select * into target from site_agent_runs_v2 where id = target_run_id for update;
  if target.id is null or target.status <> 'queued' then return null; end if;
  claimed := jsonb_set(jsonb_set(jsonb_set(jsonb_set(target.run, '{status}', '"running"'::jsonb), '{stage}', '"authoring"'::jsonb),
    '{attempt}', to_jsonb(coalesce((target.run ->> 'attempt')::integer, 0) + 1)), '{heartbeatAt}', to_jsonb(now_value));
  update site_agent_runs_v2 set status = 'running', run = claimed where id = target_run_id;
  return claimed;
end;
$$;
revoke all on function claim_site_agent_run_v2(text) from public;
grant execute on function claim_site_agent_run_v2(text) to service_role;

do $$
declare definition text;
begin
  if to_regprocedure('cleanup_agentic_walking_skeleton_v1(text,text)') is not null then
    select pg_get_functiondef('cleanup_agentic_walking_skeleton_v1(text,text)'::regprocedure) into definition;
    execute replace(definition, 'site_agent_runs_v1', 'site_agent_runs_v2');
  end if;
  if to_regprocedure('cleanup_experimental_site_v1(text,text,text)') is not null then
    select pg_get_functiondef('cleanup_experimental_site_v1(text,text,text)'::regprocedure) into definition;
    execute replace(definition, 'site_agent_runs_v1', 'site_agent_runs_v2');
  end if;
end;
$$;

create table site_agent_trace_spans_v1 (
  sequence bigint generated always as identity unique,
  id text primary key,
  trace_id text not null,
  run_id text references site_agent_runs_v2(id) on delete cascade,
  session_id text references site_agent_sessions(id) on delete cascade,
  request_id text,
  parent_span_id text references site_agent_trace_spans_v1(id) on delete cascade,
  schema_version text not null check (schema_version = 'site-agent-trace-span-v1'),
  kind text not null check (kind in ('attempt', 'turn', 'model_request', 'tool_call', 'build', 'inspection', 'critic', 'retry', 'preflight', 'subagent')),
  name text not null,
  status text not null check (status in ('running', 'succeeded', 'failed', 'cancelled')),
  attempt_index integer,
  turn_index integer,
  model_id text,
  input_tokens integer,
  cached_input_tokens integer,
  output_tokens integer,
  summary jsonb not null default '{}'::jsonb,
  payload_ref text,
  payload_hash text,
  payload_expires_at timestamptz,
  error_code text,
  started_at timestamptz not null,
  completed_at timestamptz,
  check (run_id is not null or request_id is not null),
  check ((payload_ref is null) = (payload_hash is null)),
  check (status = 'running' or completed_at is not null)
);
create index site_agent_trace_spans_v1_trace_idx on site_agent_trace_spans_v1(trace_id, sequence);
create index site_agent_trace_spans_v1_payload_expiry_idx on site_agent_trace_spans_v1(payload_expires_at) where payload_ref is not null;
alter table site_agent_trace_spans_v1 enable row level security;
grant select, insert, update, delete on site_agent_trace_spans_v1 to service_role;
grant usage, select on sequence site_agent_trace_spans_v1_sequence_seq to service_role;

create table site_agent_maintenance_leases_v1 (
  task text primary key,
  lease_until timestamptz not null,
  claimed_at timestamptz not null
);
alter table site_agent_maintenance_leases_v1 enable row level security;
grant select, insert, update on site_agent_maintenance_leases_v1 to service_role;

create or replace function claim_site_agent_maintenance_v1(task_name text, lease_until_value timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare affected_rows integer := 0;
begin
  insert into site_agent_maintenance_leases_v1(task, lease_until, claimed_at)
  values (task_name, lease_until_value, now())
  on conflict (task) do update set lease_until = excluded.lease_until, claimed_at = excluded.claimed_at
  where site_agent_maintenance_leases_v1.lease_until <= now();
  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$$;
revoke all on function claim_site_agent_maintenance_v1(text, timestamptz) from public;
grant execute on function claim_site_agent_maintenance_v1(text, timestamptz) to service_role;
