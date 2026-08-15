-- Minimal blue-green sandbox deployments and durable needs-input checkpoints.

begin;

create table public.site_sandbox_deployments (
  id text primary key,
  schema_version integer not null check (schema_version = 1),
  slot text not null check (slot in ('blue', 'green')),
  worker_version_id text not null check (length(worker_version_id) between 1 and 200),
  release_sha text not null check (release_sha ~ '^[a-f0-9]{40}$'),
  image_digest text not null check (image_digest ~ '^sha256:[a-f0-9]{64}$'),
  credential_slot text not null check (credential_slot in ('blue', 'green') and credential_slot = slot),
  manifest jsonb not null,
  deployment jsonb not null,
  created_at timestamptz not null,
  check (deployment->>'id' = id),
  check ((deployment->>'schemaVersion')::integer = schema_version),
  check (deployment->>'slot' = slot),
  check (deployment->>'workerVersionId' = worker_version_id),
  check (deployment->>'releaseSha' = release_sha),
  check (deployment->>'imageDigest' = image_digest),
  check (deployment->>'credentialSlot' = credential_slot),
  check (deployment->'manifest' = manifest)
);

create table public.site_sandbox_control (
  id text primary key check (id = 'production'),
  schema_version integer not null check (schema_version = 1),
  blue_deployment_id text not null references public.site_sandbox_deployments(id) on delete restrict,
  green_deployment_id text references public.site_sandbox_deployments(id) on delete restrict,
  active_deployment_id text not null references public.site_sandbox_deployments(id) on delete restrict,
  control jsonb not null,
  updated_at timestamptz not null,
  check (active_deployment_id = blue_deployment_id or active_deployment_id = green_deployment_id),
  check (control->>'id' = id),
  check ((control->>'schemaVersion')::integer = schema_version),
  check (control->>'blueDeploymentId' = blue_deployment_id),
  check (nullif(control->>'greenDeploymentId', '') is not distinct from green_deployment_id),
  check (control->>'activeDeploymentId' = active_deployment_id)
);

alter table public.site_agent_sessions
  add column sandbox_deployment_id text
  references public.site_sandbox_deployments(id) on delete restrict;

create table public.site_agent_workspace_checkpoints (
  id text primary key,
  schema_version integer not null check (schema_version = 1),
  run_id text not null references public.site_agent_runs(id) on delete restrict,
  execution_number integer not null check (execution_number > 0),
  base_workspace_revision_id text references public.site_workspace_revisions(id) on delete restrict,
  public_build_input_id text not null references public.site_public_build_inputs(id) on delete restrict,
  sandbox_deployment_id text not null references public.site_sandbox_deployments(id) on delete restrict,
  sandbox_id text not null check (length(sandbox_id) between 1 and 255),
  workspace_hash text not null check (workspace_hash ~ '^sha256:[a-f0-9]{64}$'),
  backup_key text not null unique check (backup_key ~ '^workspace-backups/[a-f0-9]{64}\.tar\.gz$'),
  backup_hash text not null check (backup_hash ~ '^sha256:[a-f0-9]{64}$'),
  backup_bytes bigint not null check (backup_bytes >= 0),
  sidecar_key text not null unique check (sidecar_key ~ '^workspace-sources/[a-f0-9]{64}\.json$'),
  sidecar_hash text not null check (sidecar_hash ~ '^sha256:[a-f0-9]{64}$'),
  sidecar_bytes bigint not null check (sidecar_bytes >= 0),
  checkpoint jsonb not null,
  created_at timestamptz not null,
  check (checkpoint->>'id' = id),
  check ((checkpoint->>'schemaVersion')::integer = schema_version),
  check (checkpoint->>'runId' = run_id),
  check ((checkpoint->>'executionNumber')::integer = execution_number),
  check (nullif(checkpoint->>'baseWorkspaceRevisionId', '') is not distinct from base_workspace_revision_id),
  check (checkpoint->>'publicBuildInputId' = public_build_input_id),
  check (checkpoint->>'sandboxDeploymentId' = sandbox_deployment_id),
  check (checkpoint->>'sandboxId' = sandbox_id),
  check (checkpoint->>'workspaceHash' = workspace_hash),
  check (checkpoint#>>'{backup,key}' = backup_key),
  check (checkpoint#>>'{backup,contentHash}' = backup_hash),
  check ((checkpoint#>>'{backup,bytes}')::bigint = backup_bytes),
  check (checkpoint#>>'{sidecar,key}' = sidecar_key),
  check (checkpoint#>>'{sidecar,contentHash}' = sidecar_hash),
  check ((checkpoint#>>'{sidecar,bytes}')::bigint = sidecar_bytes)
);

alter table public.site_agent_runs
  add column sandbox_deployment_id text
    references public.site_sandbox_deployments(id) on delete restrict,
  add column resume_checkpoint_id text
    references public.site_agent_workspace_checkpoints(id) on delete restrict;

do $$
declare
  definition text;
  session_anchor constant text :=
    '    sandbox_id = nullif(session_document->>''sandboxId'', ''''),';
  run_anchor constant text :=
    '    status = run_document->>''status'',';
begin
  select pg_get_functiondef(
    'public.finalize_verified_authoring(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ) into definition;
  if strpos(definition, session_anchor) = 0 or strpos(definition, run_anchor) = 0 then
    raise exception 'finalize_verified_authoring_sandbox_fence_anchor_missing';
  end if;
  definition := replace(
    definition,
    session_anchor,
    '    sandbox_deployment_id = nullif(session_document->>''sandboxDeploymentId'', ''''),' || E'\n' || session_anchor
  );
  definition := replace(
    definition,
    run_anchor,
    run_anchor || E'\n' ||
    '    sandbox_deployment_id = nullif(run_document->>''sandboxDeploymentId'', ''''),' || E'\n' ||
    '    resume_checkpoint_id = nullif(run_document->>''resumeCheckpointId'', ''''),'
  );
  execute definition;
end;
$$;

create index site_sandbox_deployments_slot_created_idx
  on public.site_sandbox_deployments(slot, created_at desc);
create index site_agent_sessions_sandbox_deployment_idx
  on public.site_agent_sessions(sandbox_deployment_id)
  where sandbox_id is not null;
create index site_agent_workspace_checkpoints_run_idx
  on public.site_agent_workspace_checkpoints(run_id, created_at desc);
create index site_agent_workspace_checkpoints_workspace_revision_idx
  on public.site_agent_workspace_checkpoints(base_workspace_revision_id)
  where base_workspace_revision_id is not null;
create index site_agent_workspace_checkpoints_public_input_idx
  on public.site_agent_workspace_checkpoints(public_build_input_id);
create index site_agent_workspace_checkpoints_deployment_idx
  on public.site_agent_workspace_checkpoints(sandbox_deployment_id);
create index site_agent_runs_sandbox_deployment_idx
  on public.site_agent_runs(sandbox_deployment_id)
  where status = 'running';
create index site_agent_runs_resume_checkpoint_idx
  on public.site_agent_runs(resume_checkpoint_id)
  where resume_checkpoint_id is not null;

create or replace function public.private_reject_immutable_sandbox_record_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception '% records are immutable', tg_table_name;
end;
$$;

create trigger site_sandbox_deployments_immutable
  before update or delete on public.site_sandbox_deployments
  for each row execute function public.private_reject_immutable_sandbox_record_change();
create trigger site_agent_workspace_checkpoints_immutable
  before update or delete on public.site_agent_workspace_checkpoints
  for each row execute function public.private_reject_immutable_sandbox_record_change();

create or replace function public.set_site_sandbox_control(control_document jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  retained public.site_sandbox_control;
  blue public.site_sandbox_deployments;
  green public.site_sandbox_deployments;
  blue_id text := control_document->>'blueDeploymentId';
  green_id text := nullif(control_document->>'greenDeploymentId', '');
  active_id text := control_document->>'activeDeploymentId';
  changed_slot_id text;
begin
  perform pg_advisory_xact_lock(hashtextextended('site-sandbox-control', 0));
  if (control_document->>'id') is distinct from 'production'
    or (control_document->>'schemaVersion')::integer is distinct from 1 then
    raise exception 'invalid_sandbox_control';
  end if;

  select * into blue
    from public.site_sandbox_deployments
    where id = blue_id and slot = 'blue';
  if blue.id is null then raise exception 'sandbox_blue_deployment_invalid'; end if;
  if green_id is not null then
    select * into green
      from public.site_sandbox_deployments
      where id = green_id and slot = 'green';
    if green.id is null then raise exception 'sandbox_green_deployment_invalid'; end if;
  end if;
  if active_id <> blue_id and active_id is distinct from green_id then
    raise exception 'sandbox_active_deployment_invalid';
  end if;

  select * into retained
    from public.site_sandbox_control
    where id = 'production'
    for update;
  if retained.id is not null then
    foreach changed_slot_id in array array[
      case when retained.blue_deployment_id is distinct from blue_id then retained.blue_deployment_id end,
      case when retained.green_deployment_id is distinct from green_id then retained.green_deployment_id end
    ] loop
      if changed_slot_id is null then continue; end if;
      if exists (
        select 1 from public.site_agent_runs run_row
        where run_row.status = 'running'
          and run_row.sandbox_deployment_id = changed_slot_id
      ) or exists (
        select 1 from public.site_agent_sessions session_row
        where session_row.sandbox_id is not null
          and session_row.sandbox_deployment_id = changed_slot_id
      ) then
        raise exception 'sandbox_slot_is_draining:%', changed_slot_id;
      end if;
    end loop;
  end if;

  insert into public.site_sandbox_control (
    id, schema_version, blue_deployment_id, green_deployment_id,
    active_deployment_id, control, updated_at
  ) values (
    'production', 1, blue_id, green_id, active_id,
    control_document, (control_document->>'updatedAt')::timestamptz
  )
  on conflict (id) do update set
    blue_deployment_id = excluded.blue_deployment_id,
    green_deployment_id = excluded.green_deployment_id,
    active_deployment_id = excluded.active_deployment_id,
    control = excluded.control,
    updated_at = excluded.updated_at;
  return control_document;
end;
$$;

create or replace function public.rollback_site_sandbox_deployment(
  target_failed_deployment_id text,
  target_previous_deployment_id text,
  target_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  retained public.site_sandbox_control;
  affected_ids jsonb := '[]'::jsonb;
  now_iso text := to_char(target_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  perform pg_advisory_xact_lock(hashtextextended('site-sandbox-control', 0));
  select * into retained from public.site_sandbox_control
    where id = 'production' for update;
  if retained.id is null
    or retained.active_deployment_id <> target_failed_deployment_id
    or (target_previous_deployment_id <> retained.blue_deployment_id
      and target_previous_deployment_id is distinct from retained.green_deployment_id) then
    raise exception 'sandbox_rollback_pointer_mismatch';
  end if;
  select coalesce(jsonb_agg(run_row.id order by run_row.id), '[]'::jsonb)
    into affected_ids
    from public.site_agent_runs run_row
    where run_row.status = 'running'
      and run_row.sandbox_deployment_id = target_failed_deployment_id;
  update public.site_agent_run_events event_row set
    status = 'failed',
    completed_at = target_now,
    error_code = 'sandbox_deployment_rollback'
    where event_row.status = 'running'
      and event_row.run_id in (select jsonb_array_elements_text(affected_ids));
  update public.site_agent_continuation_heads continuation set
    status = 'stale',
    head = jsonb_set(jsonb_set(continuation.head, '{status}', '"stale"', true),
      '{updatedAt}', to_jsonb(now_iso), true),
    updated_at = target_now
    where continuation.run_id in (select jsonb_array_elements_text(affected_ids));
  update public.site_agent_runs run_row set
    status = 'queued',
    sandbox_deployment_id = null,
    run = jsonb_set(
      jsonb_set(
        jsonb_set(
          (run_row.run - 'sandboxDeploymentId' - 'workerId' - 'heartbeatAt' - 'completedAt'),
          '{status}', '"queued"', true
        ),
        '{stage}', '"queued"', true
      ),
      '{executionNumber}', to_jsonb((run_row.run->>'executionNumber')::integer + 1), true
    ) || jsonb_build_object('failureReason', 'sandbox_deployment_rollback'),
    completed_at = null
    where run_row.id in (select jsonb_array_elements_text(affected_ids));
  update public.site_agent_sessions session_row set
    status = 'rotating',
    lease_expires_at = target_now,
    updated_at = target_now
    where session_row.sandbox_deployment_id = target_failed_deployment_id
      and session_row.sandbox_id is not null;
  update public.site_sandbox_control set
    active_deployment_id = target_previous_deployment_id,
    control = jsonb_set(jsonb_set(control, '{activeDeploymentId}', to_jsonb(target_previous_deployment_id), true),
      '{updatedAt}', to_jsonb(now_iso), true),
    updated_at = target_now
    where id = 'production';
  return affected_ids;
end;
$$;

drop function if exists public.claim_site_agent_run(text);
drop function if exists public.claim_next_site_agent_run(text,timestamptz);

create function public.claim_site_agent_run(
  target_run_id text,
  target_worker_id text,
  target_claimed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_run public.site_agent_runs;
  queued_run public.site_agent_runs;
  target_run public.site_agent_runs;
  target_site public.sites;
  target_checkpoint public.site_agent_workspace_checkpoints;
  control_row public.site_sandbox_control;
  active_count integer;
  next_execution integer;
  merged_change_ids jsonb := '[]'::jsonb;
  change_id text;
  run_value jsonb;
  checkpoint_current boolean := false;
begin
  if target_worker_id is null or length(target_worker_id) not between 1 and 200 then
    raise exception 'invalid_worker_id';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('site-authoring-maintenance-claim-fence', 0));
  if exists (
    select 1 from public.site_agent_maintenance_leases maintenance_lease
    where maintenance_lease.task = 'site_authoring_maintenance'
      and maintenance_lease.lease_until > target_claimed_at
  ) then return null; end if;

  perform pg_advisory_xact_lock(hashtextextended('site-sandbox-control', 0));
  select * into control_row
    from public.site_sandbox_control
    where id = 'production';
  if control_row.id is null or not exists (
    select 1 from public.site_sandbox_deployments deployment
    where deployment.id = control_row.active_deployment_id
  ) then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('site-agent-global-capacity', 0));
  select count(*) into active_count
    from public.site_agent_runs candidate
    where candidate.status = 'running';
  if active_count >= 4 then return null; end if;

  if target_run_id is null then
    select candidate.* into selected_run
      from public.site_agent_runs candidate
      where candidate.status = 'queued'
        and not exists (
          select 1 from public.site_agent_runs active
          where active.site_id = candidate.site_id
            and active.status = 'running'
        )
        and exists (
          select 1 from public.site_agent_sessions claim_session
          where claim_session.id = candidate.session_id
            and not (claim_session.status = 'rotating' and claim_session.sandbox_id is not null)
        )
        and (
          nullif(candidate.run->>'deferredUntilRunId', '') is null
          or not exists (
            select 1 from public.site_agent_runs predecessor
            where predecessor.id = candidate.run->>'deferredUntilRunId'
              and predecessor.status in ('queued', 'running')
          )
        )
      order by candidate.started_at, candidate.id
      for update skip locked
      limit 1;
  else
    select candidate.* into selected_run
      from public.site_agent_runs candidate
      where candidate.id = target_run_id
        and candidate.status = 'queued'
        and not exists (
          select 1 from public.site_agent_runs active
          where active.site_id = candidate.site_id
            and active.status = 'running'
        )
        and exists (
          select 1 from public.site_agent_sessions claim_session
          where claim_session.id = candidate.session_id
            and not (claim_session.status = 'rotating' and claim_session.sandbox_id is not null)
        )
        and (
          nullif(candidate.run->>'deferredUntilRunId', '') is null
          or not exists (
            select 1 from public.site_agent_runs predecessor
            where predecessor.id = candidate.run->>'deferredUntilRunId'
              and predecessor.status in ('queued', 'running')
          )
        )
      for update skip locked;
  end if;
  if selected_run.id is null then return null; end if;

  target_run := selected_run;
  if target_run_id is null and selected_run.run#>>'{request,kind}' = 'authority_refresh' then
    for queued_run in
      select candidate.*
      from public.site_agent_runs candidate
      where candidate.site_id = selected_run.site_id
        and candidate.status = 'queued'
        and (candidate.started_at, candidate.id) >= (selected_run.started_at, selected_run.id)
      order by candidate.started_at, candidate.id
      for update
    loop
      exit when queued_run.run#>>'{request,kind}' <> 'authority_refresh';
      target_run := queued_run;
      for change_id in select jsonb_array_elements_text(
        coalesce(queued_run.run#>'{request,changeRequestIds}', '[]'::jsonb)
      ) loop
        if not (merged_change_ids ? change_id) then
          merged_change_ids := merged_change_ids || to_jsonb(change_id);
        end if;
      end loop;
    end loop;
    update public.site_agent_runs coalesced set
      status = 'cancelled',
      completed_at = target_claimed_at,
      run = jsonb_set(
        jsonb_set(jsonb_set(coalesced.run, '{status}', '"cancelled"', true),
          '{coalescedIntoRunId}', to_jsonb(target_run.id), true),
        '{completedAt}', to_jsonb(to_char(target_claimed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), true
      )
      where coalesced.site_id = selected_run.site_id
        and coalesced.status = 'queued'
        and coalesced.id <> target_run.id
        and coalesced.run#>>'{request,kind}' = 'authority_refresh'
        and (coalesced.started_at, coalesced.id) < (target_run.started_at, target_run.id)
        and not exists (
          select 1 from public.site_agent_runs barrier
          where barrier.site_id = selected_run.site_id
            and barrier.status = 'queued'
            and barrier.run#>>'{request,kind}' <> 'authority_refresh'
            and (barrier.started_at, barrier.id) > (selected_run.started_at, selected_run.id)
            and (barrier.started_at, barrier.id) < (coalesced.started_at, coalesced.id)
        );
    target_run.run := jsonb_set(
      target_run.run, '{request}',
      jsonb_build_object('kind', 'authority_refresh', 'changeRequestIds', merged_change_ids), true
    ) - 'deferredUntilRunId';
  end if;

  select * into target_site
    from public.sites site_row
    where site_row.id = target_run.site_id
      and site_row.owner_user_id is not null
      and site_row.status <> 'paused'
      and site_row.current_public_build_input_id is not null
    for update;
  if target_site.id is null then return null; end if;
  if exists (
    select 1 from public.site_agent_runs active
    where active.site_id = target_run.site_id
      and active.status = 'running'
  ) then return null; end if;

  if target_run.resume_checkpoint_id is not null then
    select * into target_checkpoint
      from public.site_agent_workspace_checkpoints checkpoint_row
      where checkpoint_row.id = target_run.resume_checkpoint_id
      for update;
    checkpoint_current := target_checkpoint.id is not null
      and target_checkpoint.base_workspace_revision_id is not distinct from target_site.current_workspace_revision_id
      and target_checkpoint.public_build_input_id = target_site.current_public_build_input_id;
  end if;

  next_execution := coalesce((target_run.run->>'executionNumber')::integer, 0) + 1;
  run_value := target_run.run
    - 'completedAt' - 'failureCode' - 'failureCategory' - 'failureReason'
    - 'retryableByOwner' - 'coalescedIntoRunId' - 'inputExpiresAt';
  run_value := jsonb_set(run_value, '{status}', '"running"', true);
  run_value := jsonb_set(run_value, '{stage}', case
    when run_value#>>'{request,kind}' = 'initial_build' then '"retrieving_sources"'::jsonb
    else '"authoring"'::jsonb end, true);
  run_value := jsonb_set(run_value, '{publicBuildInputId}', to_jsonb(target_site.current_public_build_input_id), true);
  if target_site.current_workspace_revision_id is null then
    run_value := run_value - 'exactParentRevisionId';
  else
    run_value := jsonb_set(run_value, '{exactParentRevisionId}', to_jsonb(target_site.current_workspace_revision_id), true);
  end if;
  run_value := run_value - 'deferredUntilRunId';
  run_value := jsonb_set(run_value, '{sandboxDeploymentId}', to_jsonb(control_row.active_deployment_id), true);
  if target_run.resume_checkpoint_id is not null and not checkpoint_current then
    run_value := (run_value - 'resumeCheckpointId');
    run_value := jsonb_set(run_value, '{checkpointRestartedAt}',
      to_jsonb(to_char(target_claimed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), true);
    update public.site_agent_continuation_heads set
      status = 'stale',
      head = jsonb_set(jsonb_set(head, '{status}', '"stale"', true), '{updatedAt}',
        to_jsonb(to_char(target_claimed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), true),
      updated_at = target_claimed_at
      where run_id = target_run.id;
  end if;
  run_value := jsonb_set(run_value, '{executionNumber}', to_jsonb(next_execution), true);
  run_value := jsonb_set(run_value, '{workerId}', to_jsonb(target_worker_id), true);
  run_value := jsonb_set(run_value, '{heartbeatAt}',
    to_jsonb(to_char(target_claimed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), true);

  update public.site_agent_runs candidate set
    status = 'running',
    exact_parent_revision_id = target_site.current_workspace_revision_id,
    sandbox_deployment_id = control_row.active_deployment_id,
    resume_checkpoint_id = case when checkpoint_current then target_run.resume_checkpoint_id else null end,
    run = run_value,
    completed_at = null
    where candidate.id = target_run.id and candidate.status = 'queued'
    returning candidate.* into target_run;
  if target_run.id is null then return null; end if;
  return target_run.run;
end;
$$;

create or replace function public.requeue_interrupted_site_agent_run(
  target_run_id text,
  target_execution_number integer,
  target_now timestamptz,
  target_failure_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  retained public.site_agent_runs;
  run_value jsonb;
begin
  if target_failure_reason is null or length(target_failure_reason) not between 1 and 2000 then
    raise exception 'invalid_recovery_reason';
  end if;
  select * into retained from public.site_agent_runs run_row
    where run_row.id = target_run_id
    for update;
  if retained.id is null then return null; end if;
  if retained.status <> 'running'
    or (retained.run->>'executionNumber')::integer <> target_execution_number then
    return retained.run;
  end if;
  run_value := retained.run
    - 'sandboxDeploymentId' - 'workerId' - 'heartbeatAt' - 'fastPreviewPath'
    - 'failureCode' - 'failureCategory' - 'completedAt';
  run_value := jsonb_set(run_value, '{status}', '"queued"', true);
  run_value := jsonb_set(run_value, '{stage}', '"queued"', true);
  run_value := jsonb_set(run_value, '{executionNumber}', to_jsonb(target_execution_number + 1), true);
  run_value := jsonb_set(run_value, '{retryableByOwner}', 'false', true);
  run_value := jsonb_set(run_value, '{failureReason}', to_jsonb(target_failure_reason), true);
  update public.site_agent_runs run_row set
    status = 'queued',
    sandbox_deployment_id = null,
    run = run_value,
    completed_at = null
    where run_row.id = retained.id
      and run_row.status = 'running'
      and (run_row.run->>'executionNumber')::integer = target_execution_number;
  if not found then
    select * into retained from public.site_agent_runs where id = target_run_id;
    return retained.run;
  end if;
  return run_value;
end;
$$;

drop function public.set_current_public_build_input_if_authority_matches(text,text,integer,integer);
create function public.set_current_public_build_input_if_authority_matches(
  target_site_id text,
  target_input_id text,
  target_owner_operational_revision integer,
  target_owner_intent_revision integer,
  target_run_id text,
  target_execution_number integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  retained_run public.site_agent_runs;
  touched integer;
begin
  select * into retained_run from public.site_agent_runs run_row
    where run_row.id = target_run_id
      and run_row.site_id = target_site_id
      and run_row.status = 'running'
      and (run_row.run->>'executionNumber')::integer = target_execution_number
    for update;
  if retained_run.id is null then return false; end if;
  perform 1
    from public.sites site_row
    join public.business_states state_row on state_row.business_id = site_row.business_id
    join public.site_intents intent_row on intent_row.site_id = site_row.id
    join public.site_public_build_inputs input_row
      on input_row.id = target_input_id and input_row.site_id = site_row.id
    where site_row.id = target_site_id
      and (state_row.state->>'ownerOperationalRevision')::integer = target_owner_operational_revision
      and (intent_row.intent->>'ownerIntentRevision')::integer = target_owner_intent_revision
      and input_row.owner_operational_revision = target_owner_operational_revision
      and input_row.owner_intent_revision = target_owner_intent_revision
    for update of site_row;
  if not found then return false; end if;
  update public.sites set
    current_public_build_input_id = target_input_id,
    updated_at = now()
    where id = target_site_id;
  get diagnostics touched = row_count;
  return touched = 1;
end;
$$;

create or replace function public.save_site_agent_session_for_execution(
  session_document jsonb,
  target_run_id text,
  target_execution_number integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  retained_run public.site_agent_runs;
begin
  select * into retained_run from public.site_agent_runs run_row
    where run_row.id = target_run_id
      and run_row.session_id = session_document->>'id'
      and run_row.status = 'running'
      and (run_row.run->>'executionNumber')::integer = target_execution_number
    for update;
  if retained_run.id is null then return null; end if;
  update public.site_agent_sessions set
    status = session_document->>'status',
    current_workspace_revision_id = nullif(session_document->>'currentWorkspaceRevisionId', ''),
    public_build_input_id = session_document->>'publicBuildInputId',
    sandbox_deployment_id = nullif(session_document->>'sandboxDeploymentId', ''),
    sandbox_id = nullif(session_document->>'sandboxId', ''),
    sandbox_last_started_at = nullif(session_document->>'sandboxLastStartedAt', '')::timestamptz,
    sandbox_last_destroyed_at = nullif(session_document->>'sandboxLastDestroyedAt', '')::timestamptz,
    sandbox_provisioned_ms = coalesce((session_document->>'sandboxProvisionedMs')::bigint, 0),
    sandbox_destroy_attempts = coalesce((session_document->>'sandboxDestroyAttempts')::integer, 0),
    lease_token_hash = session_document->>'leaseTokenHash',
    lease_expires_at = (session_document->>'leaseExpiresAt')::timestamptz,
    rotate_at = (session_document->>'rotateAt')::timestamptz,
    updated_at = (session_document->>'updatedAt')::timestamptz
    where id = retained_run.session_id;
  if not found then return null; end if;
  return session_document;
end;
$$;

create function public.apply_managed_form_authoring_change(
  target_expected_public_input_id text,
  target_expected_intent_revision integer,
  form_document jsonb,
  intent_document jsonb,
  public_input_document jsonb,
  session_document jsonb,
  run_document jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  retained_run public.site_agent_runs;
  target_site public.sites;
  current_state public.business_states;
  current_intent public.site_intents;
  saved_run jsonb;
  saved_session jsonb;
begin
  select * into retained_run from public.site_agent_runs run_row
    where run_row.id = run_document->>'id'
    for update;
  if retained_run.id is null
    or retained_run.status <> 'running'
    or (retained_run.run->>'executionNumber')::integer <>
      (run_document->>'executionNumber')::integer
    or retained_run.session_id <> session_document->>'id'
    or retained_run.run->>'publicBuildInputId' <>
      target_expected_public_input_id then
    return null;
  end if;

  select * into target_site from public.sites site_row
    where site_row.id = retained_run.site_id
    for update;
  select * into current_state from public.business_states state_row
    where state_row.business_id = target_site.business_id
    for update;
  select * into current_intent from public.site_intents intent_row
    where intent_row.site_id = target_site.id
    for update;
  if target_site.id is null
    or current_state.business_id is null
    or current_intent.id is null
    or target_site.current_public_build_input_id is distinct from
      target_expected_public_input_id
    or current_intent.revision <> target_expected_intent_revision
    or intent_document->>'id' <> current_intent.id
    or intent_document->>'siteId' <> target_site.id
    or (intent_document->>'revision')::integer <> current_intent.revision + 1
    or (intent_document->>'ownerIntentRevision')::integer <>
      (current_intent.intent->>'ownerIntentRevision')::integer + 1
    or form_document->>'siteId' <> target_site.id
    or public_input_document->>'siteId' <> target_site.id
    or public_input_document->>'businessId' <> target_site.business_id
    or (public_input_document->>'ownerOperationalRevision')::integer <>
      (current_state.state->>'ownerOperationalRevision')::integer
    or (public_input_document->>'ownerIntentRevision')::integer <>
      (intent_document->>'ownerIntentRevision')::integer
    or session_document->>'siteId' <> target_site.id
    or session_document->>'publicBuildInputId' <> public_input_document->>'id'
    or run_document->>'siteId' <> target_site.id
    or run_document->>'publicBuildInputId' <> public_input_document->>'id'
    or not exists (
      select 1 from jsonb_array_elements(public_input_document->'forms') item
      where item->>'id' = form_document->>'id'
    ) then
    return null;
  end if;

  insert into public.form_definitions (
    id, site_id, schema_version, revision, status, definition, created_at
  ) values (
    form_document->>'id', form_document->>'siteId',
    (form_document->>'schemaVersion')::integer,
    (form_document->>'revision')::integer, form_document->>'status',
    form_document, (form_document->>'createdAt')::timestamptz
  );
  update public.site_intents set
    schema_version = (intent_document->>'schemaVersion')::integer,
    revision = (intent_document->>'revision')::integer,
    intent_hash = intent_document->>'intentHash',
    intent = intent_document,
    updated_at = (intent_document->>'updatedAt')::timestamptz
    where id = current_intent.id and revision = target_expected_intent_revision;
  if not found then raise exception 'managed_form_intent_revision_conflict'; end if;

  insert into public.site_public_build_inputs (
    id, site_id, business_id, schema_version,
    owner_operational_revision, owner_intent_revision,
    input_hash, input, created_at
  ) values (
    public_input_document->>'id', public_input_document->>'siteId',
    public_input_document->>'businessId',
    (public_input_document->>'schemaVersion')::integer,
    (public_input_document->>'ownerOperationalRevision')::integer,
    (public_input_document->>'ownerIntentRevision')::integer,
    public_input_document->>'inputHash', public_input_document,
    (public_input_document->>'createdAt')::timestamptz
  );
  insert into public.site_public_build_input_sources
    select public_input_document->>'id', value
    from jsonb_array_elements_text(public_input_document->'sourceSnapshotIds');
  insert into public.site_public_build_input_assets
    select public_input_document->>'id', value
    from jsonb_array_elements_text(public_input_document->'assetRevisionIds');
  insert into public.site_public_build_input_forms
    select public_input_document->>'id', value->>'id'
    from jsonb_array_elements(public_input_document->'forms');

  update public.sites set
    current_public_build_input_id = public_input_document->>'id',
    updated_at = (intent_document->>'updatedAt')::timestamptz
    where id = target_site.id;
  update public.site_versions set
    status = 'stale',
    stale_reason = 'owner_authority_changed',
    version = jsonb_set(
      jsonb_set(version, '{status}', '"stale"', true),
      '{staleReason}', '"owner_authority_changed"', true
    )
    where site_id = target_site.id and status = 'candidate';

  saved_session := public.save_site_agent_session_for_execution(
    session_document,
    run_document->>'id',
    (run_document->>'executionNumber')::integer
  );
  saved_run := public.save_site_agent_run(run_document);
  if saved_session is null or saved_run is distinct from run_document then
    raise exception 'managed_form_execution_fence_lost';
  end if;
  return jsonb_build_object('run', saved_run, 'session', saved_session);
end;
$$;

create or replace function public.fence_expired_site_agent_session(
  session_document jsonb,
  run_document jsonb,
  target_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  retained public.site_agent_sessions;
  retained_run public.site_agent_runs;
  session_value jsonb;
  now_iso text := to_char(target_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select * into retained from public.site_agent_sessions session_row
    where session_row.id = session_document->>'id'
      and session_row.sandbox_id is not distinct from nullif(session_document->>'sandboxId', '')
      and session_row.sandbox_deployment_id is not distinct from nullif(session_document->>'sandboxDeploymentId', '')
      and session_row.lease_expires_at = (session_document->>'leaseExpiresAt')::timestamptz
      and session_row.lease_expires_at <= target_now
    for update;
  if retained.id is null then return null; end if;
  if run_document is not null then
    select * into retained_run from public.site_agent_runs run_row
      where run_row.id = run_document->>'id'
        and run_row.session_id = retained.id
        and run_row.status = 'needs_input'
        and (run_row.run->>'executionNumber')::integer = (run_document->>'executionNumber')::integer
        and run_row.resume_checkpoint_id is not distinct from nullif(run_document->>'resumeCheckpointId', '')
        and run_row.sandbox_deployment_id is not distinct from nullif(run_document->>'sandboxDeploymentId', '')
      for update;
    if retained_run.id is null then return null; end if;
  elsif exists (
    select 1 from public.site_agent_runs active
    where active.session_id = retained.id
      and (
        active.status in ('running', 'needs_input')
        or (active.status = 'queued' and retained.status <> 'rotating')
      )
  ) then return null;
  end if;
  session_value := jsonb_set(jsonb_set(session_document, '{status}', '"rotating"', true),
    '{updatedAt}', to_jsonb(now_iso), true);
  update public.site_agent_sessions set status = 'rotating', updated_at = target_now
    where id = retained.id;
  return session_value;
end;
$$;

create or replace function public.pause_site_agent_run_for_input(
  checkpoint_document jsonb,
  run_document jsonb,
  session_document jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_run public.site_agent_runs;
  current_session public.site_agent_sessions;
  pause_time timestamptz := now();
  pause_iso text;
  lease_iso text;
  session_value jsonb;
begin
  pause_iso := to_char(pause_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  lease_iso := to_char((pause_time + interval '5 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  select * into current_run from public.site_agent_runs
    where id = run_document->>'id' for update;
  if current_run.id is null
    or current_run.status <> 'running'
    or (current_run.run->>'executionNumber')::integer <> (checkpoint_document->>'executionNumber')::integer
    or run_document->>'status' <> 'needs_input'
    or run_document->>'stage' <> 'needs_input'
    or run_document->>'resumeCheckpointId' <> checkpoint_document->>'id'
    or run_document->>'sandboxDeploymentId' <> checkpoint_document->>'sandboxDeploymentId'
    or checkpoint_document->>'runId' <> current_run.id then
    raise exception 'checkpoint_execution_fenced';
  end if;
  select * into current_session from public.site_agent_sessions
    where id = current_run.session_id for update;
  if current_session.id is null
    or session_document->>'id' <> current_session.id
    or session_document->>'sandboxId' <> checkpoint_document->>'sandboxId'
    or session_document->>'sandboxDeploymentId' <> checkpoint_document->>'sandboxDeploymentId'
    or checkpoint_document->>'publicBuildInputId' <> current_run.run->>'publicBuildInputId'
    or nullif(checkpoint_document->>'baseWorkspaceRevisionId', '')
      is distinct from current_run.exact_parent_revision_id then
    raise exception 'checkpoint_scope_mismatch';
  end if;

  insert into public.site_agent_workspace_checkpoints (
    id, schema_version, run_id, execution_number, base_workspace_revision_id,
    public_build_input_id, sandbox_deployment_id, sandbox_id, workspace_hash,
    backup_key, backup_hash, backup_bytes, sidecar_key, sidecar_hash, sidecar_bytes,
    checkpoint, created_at
  ) values (
    checkpoint_document->>'id', (checkpoint_document->>'schemaVersion')::integer,
    checkpoint_document->>'runId', (checkpoint_document->>'executionNumber')::integer,
    nullif(checkpoint_document->>'baseWorkspaceRevisionId', ''),
    checkpoint_document->>'publicBuildInputId', checkpoint_document->>'sandboxDeploymentId',
    checkpoint_document->>'sandboxId', checkpoint_document->>'workspaceHash',
    checkpoint_document#>>'{backup,key}', checkpoint_document#>>'{backup,contentHash}',
    (checkpoint_document#>>'{backup,bytes}')::bigint,
    checkpoint_document#>>'{sidecar,key}', checkpoint_document#>>'{sidecar,contentHash}',
    (checkpoint_document#>>'{sidecar,bytes}')::bigint,
    checkpoint_document, (checkpoint_document->>'createdAt')::timestamptz
  );

  session_value := jsonb_set(session_document, '{status}', '"checkpointed"', true);
  session_value := jsonb_set(session_value, '{leaseExpiresAt}', to_jsonb(lease_iso), true);
  session_value := jsonb_set(session_value, '{updatedAt}', to_jsonb(pause_iso), true);
  update public.site_agent_sessions set
    status = 'checkpointed',
    sandbox_deployment_id = checkpoint_document->>'sandboxDeploymentId',
    sandbox_id = checkpoint_document->>'sandboxId',
    lease_expires_at = pause_time + interval '5 minutes',
    updated_at = pause_time
    where id = current_session.id;
  update public.site_agent_runs set
    status = 'needs_input',
    sandbox_deployment_id = checkpoint_document->>'sandboxDeploymentId',
    resume_checkpoint_id = checkpoint_document->>'id',
    run = run_document - 'inputExpiresAt'
    where id = current_run.id
      and status = 'running'
      and (run->>'executionNumber')::integer = (checkpoint_document->>'executionNumber')::integer;
  if not found then raise exception 'checkpoint_execution_fenced'; end if;
  update public.site_agent_continuation_heads set
    status = 'awaiting_input',
    head = jsonb_set(jsonb_set(head, '{status}', '"awaiting_input"', true),
      '{updatedAt}', to_jsonb(pause_iso), true),
    updated_at = pause_time
    where run_id = current_run.id
      and execution_number = (checkpoint_document->>'executionNumber')::integer;
  return jsonb_build_object('run', run_document - 'inputExpiresAt', 'session', session_value);
end;
$$;

create or replace function public.cancel_site_agent_needs_input_run(
  target_run_id text,
  target_completed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  retained public.site_agent_runs;
  run_value jsonb;
  completed_iso text := to_char(target_completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select * into retained from public.site_agent_runs
    where id = target_run_id and status = 'needs_input' for update;
  if retained.id is null then return null; end if;
  run_value := jsonb_set(jsonb_set(retained.run - 'inputExpiresAt', '{status}', '"cancelled"', true),
    '{completedAt}', to_jsonb(completed_iso), true);
  update public.site_agent_runs set status = 'cancelled', completed_at = target_completed_at, run = run_value
    where id = retained.id and status = 'needs_input';
  update public.site_agent_continuation_heads set
    status = 'terminal',
    head = jsonb_set(jsonb_set(head, '{status}', '"terminal"', true), '{updatedAt}', to_jsonb(completed_iso), true),
    updated_at = target_completed_at
    where run_id = retained.id;
  return run_value;
end;
$$;

update public.site_agent_runs set run = run - 'inputExpiresAt'
where run ? 'inputExpiresAt';

alter table public.site_sandbox_deployments enable row level security;
alter table public.site_sandbox_control enable row level security;
alter table public.site_agent_workspace_checkpoints enable row level security;
revoke all on table public.site_sandbox_deployments, public.site_sandbox_control,
  public.site_agent_workspace_checkpoints from public, anon, authenticated;
grant select, insert on table public.site_sandbox_deployments,
  public.site_agent_workspace_checkpoints to service_role;
grant select, insert, update on table public.site_sandbox_control to service_role;

revoke all on function public.private_reject_immutable_sandbox_record_change()
  from public, anon, authenticated;
revoke all on function public.set_site_sandbox_control(jsonb)
  from public, anon, authenticated;
revoke all on function public.rollback_site_sandbox_deployment(text,text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.claim_site_agent_run(text,text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.requeue_interrupted_site_agent_run(text,integer,timestamptz,text)
  from public, anon, authenticated;
revoke all on function public.set_current_public_build_input_if_authority_matches(text,text,integer,integer,text,integer)
  from public, anon, authenticated;
revoke all on function public.save_site_agent_session_for_execution(jsonb,text,integer)
  from public, anon, authenticated;
revoke all on function public.apply_managed_form_authoring_change(text,integer,jsonb,jsonb,jsonb,jsonb,jsonb)
  from public, anon, authenticated;
revoke all on function public.pause_site_agent_run_for_input(jsonb,jsonb,jsonb)
  from public, anon, authenticated;
revoke all on function public.cancel_site_agent_needs_input_run(text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.fence_expired_site_agent_session(jsonb,jsonb,timestamptz)
  from public, anon, authenticated;
grant execute on function public.set_site_sandbox_control(jsonb) to service_role;
grant execute on function public.rollback_site_sandbox_deployment(text,text,timestamptz) to service_role;
grant execute on function public.claim_site_agent_run(text,text,timestamptz) to service_role;
grant execute on function public.requeue_interrupted_site_agent_run(text,integer,timestamptz,text) to service_role;
grant execute on function public.set_current_public_build_input_if_authority_matches(text,text,integer,integer,text,integer) to service_role;
grant execute on function public.save_site_agent_session_for_execution(jsonb,text,integer) to service_role;
grant execute on function public.apply_managed_form_authoring_change(text,integer,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.pause_site_agent_run_for_input(jsonb,jsonb,jsonb) to service_role;
grant execute on function public.cancel_site_agent_needs_input_run(text,timestamptz) to service_role;
grant execute on function public.fence_expired_site_agent_session(jsonb,jsonb,timestamptz) to service_role;

commit;
