create or replace function public.save_site_agent_run(run_document jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_run site_agent_runs;
  current_execution integer;
  requested_execution integer;
  transition_allowed boolean;
begin
  select * into current_run
    from site_agent_runs
    where id = run_document->>'id'
    for update;
  if current_run.id is null then
    raise exception 'site_agent_run_missing';
  end if;

  current_execution := coalesce((current_run.run->>'executionNumber')::integer, 0);
  requested_execution := coalesce((run_document->>'executionNumber')::integer, 0);
  transition_allowed := current_execution = requested_execution and (
    (current_run.status = 'queued' and run_document->>'status' in ('queued', 'cancelled'))
    or current_run.status = 'running'
    or (
      current_run.status = 'needs_input'
      and run_document->>'status' in ('needs_input', 'queued', 'running', 'failed', 'cancelled')
    )
  );
  if not transition_allowed then
    return current_run.run;
  end if;

  update site_agent_runs set
    session_id = run_document->>'sessionId',
    site_id = run_document->>'siteId',
    schema_version = run_document->>'schemaVersion',
    kind = run_document->>'kind',
    status = run_document->>'status',
    exact_parent_revision_id = nullif(run_document->>'exactParentRevisionId', ''),
    output_revision_id = nullif(run_document->>'outputRevisionId', ''),
    execution_driver = run_document->>'executionDriver',
    api_provider = nullif(run_document->>'apiProvider', ''),
    model_id = nullif(run_document->>'modelId', ''),
    run = run_document,
    started_at = (run_document->>'startedAt')::timestamptz,
    completed_at = nullif(run_document->>'completedAt', '')::timestamptz
    where id = current_run.id;
  return run_document;
end;
$$;

revoke all on function public.save_site_agent_run(jsonb) from public, anon, authenticated;
grant execute on function public.save_site_agent_run(jsonb) to service_role;

create or replace function public.touch_site_agent_run_heartbeat(
  target_run_id text,
  target_execution_number integer,
  target_heartbeat_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  update site_agent_runs set
    run = jsonb_set(
      run,
      '{heartbeatAt}',
      to_jsonb(to_char(target_heartbeat_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      true
    )
    where id = target_run_id
      and status = 'running'
      and coalesce((run->>'executionNumber')::integer, 0) = target_execution_number;
  get diagnostics touched = row_count;
  return touched = 1;
end;
$$;

revoke all on function public.touch_site_agent_run_heartbeat(text,integer,timestamptz)
  from public, anon, authenticated;
grant execute on function public.touch_site_agent_run_heartbeat(text,integer,timestamptz)
  to service_role;

create or replace function public.claim_site_agent_run(target_run_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_run jsonb;
  target_driver text;
  api_active integer;
  external_active integer;
  claimed_at timestamptz := now();
begin
  select execution_driver into target_driver
    from site_agent_runs
    where id = target_run_id and status = 'queued'
    for update;
  if target_driver is null then return null; end if;

  if target_driver = 'responses_api' then
    if exists (
      select 1 from site_agent_maintenance_leases
      where task = 'workspace-cutover' and lease_until > claimed_at
    ) then return null; end if;
    perform pg_advisory_xact_lock(hashtextextended('site-agent-global-capacity', 0));
    select count(*) into api_active from site_agent_runs
      where status = 'running' and execution_driver = 'responses_api';
    select count(*) into external_active from external_authoring_operations
      where status in ('reserved','running') and tool_name in ('build_preview','inspect_site','finish');
    if api_active + external_active >= 4 then return null; end if;
  end if;

  update site_agent_runs
    set status = 'running',
      run = jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(run, '{status}', '"running"', true),
            '{stage}', '"authoring"', true
          ),
          '{executionNumber}', to_jsonb(coalesce((run->>'executionNumber')::integer, 0) + 1), true
        ),
        '{heartbeatAt}', to_jsonb(to_char(claimed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), true
      )
    where id = target_run_id
      and status = 'queued'
      and execution_driver = target_driver
    returning run into target_run;
  return target_run;
end;
$$;

revoke all on function public.claim_site_agent_run(text) from public, anon, authenticated;
grant execute on function public.claim_site_agent_run(text) to service_role;

do $$
declare
  definition text;
  run_event_marker text := $block$  update site_agent_run_events$block$;
  external_fence text := $block$  update external_authoring_credentials
    set status = 'revoked', revoked_at = coalesce(revoked_at, disposed_at)
    where site_id = target_site_id
      and owner_user_id = target_owner_user_id
      and status = 'active';

  update external_authoring_operations
    set status = 'cancelled', error_code = 'site_disposed',
      completed_at = disposed_at, updated_at = disposed_at
    where execution_id in (
      select id from external_authoring_executions where site_id = target_site_id
    ) and status in ('reserved', 'running');

  update external_authoring_claims
    set status = 'fenced', operation_deadline_at = null,
      last_activity_at = disposed_at, updated_at = disposed_at
    where execution_id in (
      select id from external_authoring_executions where site_id = target_site_id
    ) and status = 'active';

  update external_authoring_executions
    set status = 'cancelled', current_operation_id = null,
      completed_at = disposed_at, last_activity_at = disposed_at, updated_at = disposed_at
    where site_id = target_site_id
      and status not in ('completed', 'failed', 'cancelled');

  update site_agent_run_events$block$;
begin
  select pg_get_functiondef(
    'public.dispose_owned_site(text,uuid)'::regprocedure
  ) into definition;
  if position(run_event_marker in definition) = 0 then
    raise exception 'dispose_owned_site_external_fence_rewrite_failed';
  end if;
  definition := replace(definition, run_event_marker, external_fence);
  execute definition;
end
$$;

do $$
declare
  definition text;
  old_site_lock text := $block$select * into target_site from sites
    where id = revision_document->>'siteId'
      and current_workspace_revision_id is not distinct from nullif(revision_document->>'parentRevisionId', '')
    for update;
  if target_site.id is null then raise exception 'stale_parent_revision'; end if;$block$;
  fenced_site_lock text := $block$select * into target_site from sites
    where id = revision_document->>'siteId'
      and owner_user_id is not null
      and status <> 'paused'
      and current_workspace_revision_id is not distinct from nullif(revision_document->>'parentRevisionId', '')
    for update;
  if target_site.id is null then raise exception 'stale_parent_revision'; end if;
  perform 1
    from site_agent_runs
    where id = run_document->>'id'
      and site_id = target_site.id
      and status = 'running'
      and coalesce((run->>'executionNumber')::integer, 0) =
        coalesce((run_document->>'executionNumber')::integer, 0)
    for update;
  if not found then raise exception 'site_agent_run_not_active'; end if;$block$;
begin
  select pg_get_functiondef(
    'public.finalize_verified_authoring(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ) into definition;
  if position(old_site_lock in definition) = 0 then
    raise exception 'finalize_verified_authoring_cancellation_fence_rewrite_failed';
  end if;
  definition := replace(definition, old_site_lock, fenced_site_lock);
  execute definition;
end
$$;
