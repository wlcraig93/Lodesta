-- Pre-launch hard cut to one unversioned operational site-authoring schema.
-- The explicit cleanup command must remove all disposable authoring data first.

do $$
begin
  if exists (select 1 from sites)
    or exists (select 1 from site_agent_sessions)
    or exists (select 1 from site_agent_runs_v2)
    or exists (select 1 from site_agent_messages)
    or exists (select 1 from site_agent_trace_spans_v1)
    or exists (select 1 from site_edit_objectives_v1)
    or exists (select 1 from control_plane_change_requests_v2)
    or exists (select 1 from site_operator_queue)
    or exists (select 1 from vertical_demand_events_v1)
    or exists (select 1 from site_agent_maintenance_leases_v1)
  then
    raise exception 'simple_site_authoring_cutover_requires_empty_operational_state';
  end if;
end;
$$;

-- Bootstrap operates only on retained authorities. Recreate it under its sole
-- canonical name before removing the transitional RPC.
do $$
declare definition text;
begin
  if to_regprocedure('bootstrap_agentic_site_v2(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)') is null then
    raise exception 'missing bootstrap source function';
  end if;
  select pg_get_functiondef('bootstrap_agentic_site_v2(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure)
    into definition;
  execute replace(definition, 'bootstrap_agentic_site_v2', 'bootstrap_site');
end;
$$;

drop function if exists cleanup_agentic_walking_skeleton_v1(text, text);
drop function if exists cleanup_experimental_site_v1(text, text, text);
drop function if exists claim_site_agent_run_v2(text);
drop function if exists claim_site_agent_run(text);
drop function if exists acquire_site_agent_maintenance_v2(text, text, timestamptz);
drop function if exists renew_site_agent_maintenance_v2(text, text, timestamptz);
drop function if exists release_site_agent_maintenance_v2(text, text);
drop function if exists site_agent_maintenance_active_v1(text);
drop trigger if exists site_agent_runs_v2_cutover_enqueue_guard on site_agent_runs_v2;
drop function if exists block_site_agent_enqueue_during_cutover_v1();
drop function if exists bootstrap_agentic_site_v2(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb);

drop table if exists site_edit_objectives_v1;
drop table if exists site_agent_trace_spans_v1;
drop table if exists site_agent_messages;
drop table if exists site_operator_queue;
drop table if exists site_agent_runs_v2;
drop table if exists site_agent_sessions;
drop table if exists control_plane_change_requests_v2;
drop table if exists vertical_demand_events_v1;
drop table if exists site_agent_maintenance_leases_v1;

create table site_agent_sessions (
  id text primary key,
  site_id text not null references sites(id) on delete restrict,
  owner_id text not null,
  schema_version text not null check (schema_version = 'site-agent-session'),
  status text not null check (status in ('active', 'checkpointed', 'rotating', 'closed', 'failed')),
  current_workspace_revision_id text references site_workspace_revisions(id) on delete restrict,
  public_build_input_id text not null references site_public_build_inputs(id) on delete restrict,
  sandbox_provider text not null check (sandbox_provider = 'cloudflare'),
  sandbox_id text,
  sandbox_last_started_at timestamptz,
  sandbox_last_destroyed_at timestamptz,
  sandbox_provisioned_ms bigint not null default 0 check (sandbox_provisioned_ms >= 0),
  sandbox_destroy_attempts integer not null default 0 check (sandbox_destroy_attempts >= 0),
  lease_token_hash text not null check (lease_token_hash ~ '^sha256:[a-f0-9]{64}$'),
  lease_expires_at timestamptz not null,
  rotate_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create unique index site_agent_sessions_one_active_idx
  on site_agent_sessions(site_id, owner_id)
  where status in ('active', 'checkpointed', 'rotating');
create index site_agent_sessions_current_workspace_revision_idx on site_agent_sessions(current_workspace_revision_id);
create index site_agent_sessions_public_build_input_idx on site_agent_sessions(public_build_input_id);

create table site_agent_runs (
  id text primary key,
  session_id text not null references site_agent_sessions(id) on delete restrict,
  site_id text not null references sites(id) on delete restrict,
  schema_version text not null check (schema_version = 'site-agent-run'),
  kind text not null check (kind in ('initial_build', 'edit', 'rebase')),
  status text not null check (status in ('queued', 'running', 'needs_input', 'succeeded', 'failed', 'cancelled')),
  exact_parent_revision_id text references site_workspace_revisions(id) on delete restrict,
  output_revision_id text references site_workspace_revisions(id) on delete restrict,
  model_id text not null,
  run jsonb not null,
  started_at timestamptz not null,
  completed_at timestamptz,
  check (status <> 'needs_input' or run ? 'inputExpiresAt')
);
create index site_agent_runs_session_idx on site_agent_runs(session_id, started_at desc);
create index site_agent_runs_site_idx on site_agent_runs(site_id, started_at desc);
create index site_agent_runs_exact_parent_idx on site_agent_runs(exact_parent_revision_id);
create index site_agent_runs_output_revision_idx on site_agent_runs(output_revision_id);
create index site_agent_runs_running_capacity_idx on site_agent_runs(id) where status = 'running';
create index site_agent_runs_needs_input_expiry_idx
  on site_agent_runs ((run ->> 'inputExpiresAt'))
  where status = 'needs_input';

create table site_agent_messages (
  id text primary key,
  schema_version text not null check (schema_version = 'site-agent-message'),
  session_id text not null references site_agent_sessions(id) on delete restrict,
  run_id text references site_agent_runs(id) on delete restrict,
  role text not null check (role in ('owner', 'agent', 'operator', 'system')),
  content text not null,
  selection jsonb,
  created_at timestamptz not null
);
create index site_agent_messages_session_idx on site_agent_messages(session_id, created_at);
create index site_agent_messages_run_idx on site_agent_messages(run_id);

create table site_agent_run_events (
  sequence bigint generated always as identity unique,
  id text primary key,
  run_id text not null references site_agent_runs(id) on delete cascade,
  schema_version text not null check (schema_version = 'site-agent-run-event'),
  kind text not null check (kind in ('run', 'turn', 'model_request', 'tool_call', 'build', 'inspection')),
  name text not null,
  status text not null check (status in ('running', 'succeeded', 'failed', 'cancelled')),
  turn_index integer,
  model_id text,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  cached_input_tokens integer check (cached_input_tokens is null or cached_input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  summary jsonb not null default '{}'::jsonb,
  payload_ref text,
  payload_hash text,
  payload_expires_at timestamptz,
  error_code text,
  started_at timestamptz not null,
  completed_at timestamptz,
  check ((payload_ref is null) = (payload_hash is null)),
  check (status = 'running' or completed_at is not null)
);
create unique index site_agent_run_events_run_sequence_idx on site_agent_run_events(run_id, sequence);
create index site_agent_run_events_payload_expiry_idx
  on site_agent_run_events(payload_expires_at)
  where payload_ref is not null;

create table site_agent_maintenance_leases (
  task text primary key,
  lease_token_hash text not null check (lease_token_hash ~ '^sha256:[a-f0-9]{64}$'),
  lease_until timestamptz not null,
  claimed_at timestamptz not null
);

create table control_plane_change_requests (
  id text primary key,
  business_id text not null references businesses(id) on delete restrict,
  site_id text not null references sites(id) on delete restrict,
  schema_version text not null check (schema_version = 'control-plane-change-request'),
  target_authority text not null check (target_authority in ('business_state', 'site_intent', 'workspace')),
  change_kind text not null,
  payload jsonb not null,
  impact text not null check (impact in ('deterministic', 'reviewable', 'structural')),
  status text not null check (status in ('pending', 'approved', 'rejected', 'applied', 'failed', 'superseded')),
  expected_business_revision integer,
  expected_intent_revision integer,
  requested_by text not null,
  requested_at timestamptz not null,
  decided_by text,
  decided_at timestamptz,
  failure_reason text
);
create index control_plane_change_requests_site_idx on control_plane_change_requests(site_id, requested_at desc);
create index control_plane_change_requests_business_idx on control_plane_change_requests(business_id, requested_at desc);

create table site_operator_queue (
  id text primary key,
  schema_version text not null check (schema_version = 'operator-queue-item'),
  site_id text not null references sites(id) on delete restrict,
  version_id text references site_versions_v4(id) on delete restrict,
  run_id text references site_agent_runs(id) on delete restrict,
  reason text not null check (reason in (
    'verification_failure', 'subjective_finding', 'stale_candidate',
    'authority_publish_failure', 'maintenance_failure'
  )),
  severity text not null check (severity in ('urgent', 'high', 'normal', 'low')),
  status text not null check (status in ('open', 'in_review', 'resolved', 'dismissed')),
  findings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  resolved_by text,
  resolved_at timestamptz,
  resolution_note text,
  check (
    status not in ('resolved', 'dismissed')
    or (resolved_by is not null and resolved_at is not null and length(trim(resolution_note)) > 0)
  )
);
create index site_operator_queue_status_idx on site_operator_queue(status, severity, created_at);
create index site_operator_queue_site_idx on site_operator_queue(site_id, created_at);
create index site_operator_queue_version_idx on site_operator_queue(version_id);
create index site_operator_queue_run_idx on site_operator_queue(run_id);

create table vertical_demand_events (
  id text primary key,
  schema_version text not null check (schema_version = 'vertical-demand-event'),
  source_url text not null,
  observed_vertical text,
  requested_by text not null,
  status text not null check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null,
  reviewed_at timestamptz,
  reviewed_by text
);
create index vertical_demand_events_status_idx on vertical_demand_events(status, created_at desc);

alter table site_agent_sessions enable row level security;
alter table site_agent_runs enable row level security;
alter table site_agent_messages enable row level security;
alter table site_agent_run_events enable row level security;
alter table site_agent_maintenance_leases enable row level security;
alter table control_plane_change_requests enable row level security;
alter table site_operator_queue enable row level security;
alter table vertical_demand_events enable row level security;

grant select, insert, update, delete on site_agent_sessions to service_role;
grant select, insert, update, delete on site_agent_runs to service_role;
grant select, insert, update, delete on site_agent_messages to service_role;
grant select, insert, update, delete on site_agent_run_events to service_role;
grant usage, select on sequence site_agent_run_events_sequence_seq to service_role;
grant select, insert, update, delete on site_agent_maintenance_leases to service_role;
grant select, insert, update, delete on control_plane_change_requests to service_role;
grant select, insert, update, delete on site_operator_queue to service_role;
grant select, insert, update, delete on vertical_demand_events to service_role;

create function acquire_site_agent_maintenance(
  task_name text,
  lease_token_hash_value text,
  lease_until_value timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare affected_rows integer := 0;
begin
  if length(trim(task_name)) = 0
    or lease_token_hash_value !~ '^sha256:[a-f0-9]{64}$'
    or lease_until_value <= now()
  then raise exception 'invalid maintenance lease request'; end if;
  insert into site_agent_maintenance_leases(task, lease_token_hash, lease_until, claimed_at)
  values (task_name, lease_token_hash_value, lease_until_value, now())
  on conflict (task) do update
    set lease_token_hash = excluded.lease_token_hash,
        lease_until = excluded.lease_until,
        claimed_at = excluded.claimed_at
  where site_agent_maintenance_leases.lease_until <= now();
  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$$;

create function renew_site_agent_maintenance(
  task_name text,
  lease_token_hash_value text,
  lease_until_value timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare affected_rows integer := 0;
begin
  if length(trim(task_name)) = 0 or lease_until_value <= now() then return false; end if;
  update site_agent_maintenance_leases
  set lease_until = lease_until_value
  where task = task_name
    and lease_token_hash = lease_token_hash_value
    and lease_until > now();
  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$$;

create function release_site_agent_maintenance(task_name text, lease_token_hash_value text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare affected_rows integer := 0;
begin
  if length(trim(task_name)) = 0 then return false; end if;
  delete from site_agent_maintenance_leases
  where task = task_name and lease_token_hash = lease_token_hash_value;
  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$$;

create function site_agent_maintenance_active(task_name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from site_agent_maintenance_leases
    where task = task_name and lease_until > now()
  );
$$;

create function claim_site_agent_run(target_run_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target site_agent_runs%rowtype;
  claimed jsonb;
  now_value timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtext('site_authoring_run_capacity'));
  if site_agent_maintenance_active('site_authoring_maintenance') then return null; end if;
  if (select count(*) from site_agent_runs where status = 'running') >= 4 then return null; end if;
  select * into target from site_agent_runs where id = target_run_id for update;
  if target.id is null or target.status <> 'queued' then return null; end if;
  claimed := jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(target.run, '{status}', '"running"'::jsonb),
        '{stage}', '"authoring"'::jsonb
      ),
      '{executionNumber}', to_jsonb(coalesce((target.run ->> 'executionNumber')::integer, 0) + 1)
    ),
    '{heartbeatAt}', to_jsonb(now_value)
  );
  update site_agent_runs set status = 'running', run = claimed where id = target_run_id;
  return claimed;
end;
$$;

create function block_site_agent_enqueue_during_maintenance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'queued' and site_agent_maintenance_active('site_authoring_maintenance') then
    raise exception 'site_authoring_maintenance_active';
  end if;
  return new;
end;
$$;
revoke all on function block_site_agent_enqueue_during_maintenance() from public;
create trigger site_agent_runs_maintenance_enqueue_guard
before insert or update of status on site_agent_runs
for each row execute function block_site_agent_enqueue_during_maintenance();

create function cleanup_experimental_site(
  target_site_id text,
  target_business_id text,
  confirmation_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare blob_keys jsonb;
begin
  if confirmation_token <> 'delete-experimental:' || target_site_id || ':' || target_business_id then
    raise exception 'experimental cleanup confirmation token does not match the target';
  end if;
  if not exists (
    select 1 from sites
    where id = target_site_id
      and business_id = target_business_id
      and status = 'experimental'
      and published_version_id is null
  ) then raise exception 'experimental cleanup requires a matching unpublished experimental site'; end if;
  if exists (select 1 from site_versions_v4 where site_id = target_site_id and status = 'published') then
    raise exception 'experimental cleanup cannot delete a site with a published version';
  end if;

  select coalesce(jsonb_agg(distinct key_value), '[]'::jsonb) into blob_keys
  from (
    select file ->> 'storageKey' as key_value
    from site_build_artifacts artifact,
      jsonb_array_elements(coalesce(artifact.artifact -> 'files', '[]'::jsonb)) file
    where artifact.site_id = target_site_id
    union all
    select source_archive_key from site_workspace_revisions where site_id = target_site_id
    union all
    select jsonb_array_elements_text(coalesce(run.run -> 'screenshotKeys', '[]'::jsonb))
    from site_agent_runs run where run.site_id = target_site_id
    union all
    select storage_path from asset_revisions where business_id = target_business_id
  ) retained_keys
  where key_value is not null and key_value <> '';

  update sites set published_version_id = null, current_workspace_revision_id = null,
    current_public_build_input_id = null where id = target_site_id;
  delete from preview_tokens where site_id = target_site_id;
  delete from domains where site_id = target_site_id;
  delete from site_redirects_v1 where site_id = target_site_id;
  delete from inquiry_events where site_id = target_site_id;
  delete from inquiries where site_id = target_site_id;
  delete from analytics_events where site_id = target_site_id;
  delete from claims where site_id = target_site_id;
  delete from site_operator_queue where site_id = target_site_id;
  delete from control_plane_change_requests where site_id = target_site_id;
  delete from site_agent_messages where session_id in (select id from site_agent_sessions where site_id = target_site_id);
  delete from site_agent_runs where site_id = target_site_id;
  delete from site_agent_sessions where site_id = target_site_id;
  delete from site_version_approvals_v1 where site_id = target_site_id;
  delete from site_version_sources where version_id in (select id from site_versions_v4 where site_id = target_site_id);
  delete from site_version_assets where version_id in (select id from site_versions_v4 where site_id = target_site_id);
  delete from site_version_forms where version_id in (select id from site_versions_v4 where site_id = target_site_id);
  delete from site_versions_v4 where site_id = target_site_id;
  delete from site_build_artifacts where site_id = target_site_id;
  delete from site_workspace_revisions where site_id = target_site_id;
  delete from site_public_build_input_sources where input_id in (select id from site_public_build_inputs where site_id = target_site_id);
  delete from site_public_build_input_assets where input_id in (select id from site_public_build_inputs where site_id = target_site_id);
  delete from site_public_build_input_forms where input_id in (select id from site_public_build_inputs where site_id = target_site_id);
  delete from site_public_build_inputs where site_id = target_site_id;
  delete from form_definitions_v2 where site_id = target_site_id;
  delete from site_intents_v3 where site_id = target_site_id;
  delete from business_states_v3 where site_id = target_site_id;
  delete from fact_observations where business_id = target_business_id;
  delete from business_assets where business_id = target_business_id;
  delete from asset_revisions where business_id = target_business_id;
  delete from business_links where business_id = target_business_id;
  delete from business_offerings where business_id = target_business_id;
  delete from business_proof where business_id = target_business_id;
  delete from source_snapshots where business_id = target_business_id;
  delete from sites where id = target_site_id;
  delete from businesses where id = target_business_id;
  return jsonb_build_object('ok', true, 'siteId', target_site_id, 'businessId', target_business_id, 'blobKeys', blob_keys);
end;
$$;

create function cleanup_site_walking_skeleton(target_site_id text, target_business_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_site_id !~ '^site_walking_[a-f0-9]{12}$'
    or target_business_id !~ '^business_walking_[a-f0-9]{12}$'
  then raise exception 'walking-skeleton cleanup accepts only generated verifier IDs'; end if;
  return cleanup_experimental_site(
    target_site_id,
    target_business_id,
    'delete-experimental:' || target_site_id || ':' || target_business_id
  );
end;
$$;

revoke all on function bootstrap_site(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
revoke all on function claim_site_agent_run(text) from public;
revoke all on function acquire_site_agent_maintenance(text, text, timestamptz) from public;
revoke all on function renew_site_agent_maintenance(text, text, timestamptz) from public;
revoke all on function release_site_agent_maintenance(text, text) from public;
revoke all on function site_agent_maintenance_active(text) from public;
revoke all on function cleanup_experimental_site(text, text, text) from public;
revoke all on function cleanup_site_walking_skeleton(text, text) from public;

grant execute on function bootstrap_site(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function claim_site_agent_run(text) to service_role;
grant execute on function acquire_site_agent_maintenance(text, text, timestamptz) to service_role;
grant execute on function renew_site_agent_maintenance(text, text, timestamptz) to service_role;
grant execute on function release_site_agent_maintenance(text, text) to service_role;
grant execute on function site_agent_maintenance_active(text) to service_role;
grant execute on function cleanup_experimental_site(text, text, text) to service_role;
grant execute on function cleanup_site_walking_skeleton(text, text) to service_role;
