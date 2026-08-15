-- Remove the pre-launch owner/site MCP adapter and its alternate execution
-- engine. Applied migration history remains immutable; this migration removes
-- every live MCP table, RPC, column, and branch.

begin;

do $$
begin
  if exists (select 1 from public.site_agent_runs limit 1)
    or exists (select 1 from public.external_authoring_executions limit 1)
    or exists (select 1 from public.external_authoring_claims limit 1)
    or exists (select 1 from public.external_authoring_operations limit 1)
    or exists (select 1 from public.external_authoring_credentials limit 1)
    or exists (select 1 from public.external_authoring_credential_requests limit 1)
    or exists (select 1 from public.authoring_execution_bundles limit 1)
    or exists (select 1 from public.staged_blob_receipts limit 1) then
    raise exception 'remove_site_authoring_mcp_requires_reviewed_prelaunch_reset';
  end if;
end;
$$;

-- The retained candidate finalizer is shared by in-app authoring. Remove only
-- its now-unreachable external execution validation and completion branches.
do $$
declare
  definition text;
  block_start integer;
  block_end integer;
  artifact_validation_marker constant text :=
    '  if artifact_document#>>''{qa,hardGate}'' <> ''passed''';
  return_marker constant text := '  return retained_result;';
begin
  select pg_get_functiondef(
    'public.finalize_verified_authoring(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ) into definition;

  definition := regexp_replace(
    definition,
    'external_document jsonb DEFAULT NULL::jsonb,[[:space:]]*',
    '',
    'i'
  );
  definition := regexp_replace(
    definition,
    '[[:space:]]*target_execution external_authoring_executions;',
    '',
    'i'
  );
  definition := regexp_replace(
    definition,
    '[[:space:]]*target_claim external_authoring_claims;',
    '',
    'i'
  );
  definition := regexp_replace(
    definition,
    '[[:space:]]*receipt_count integer;',
    '',
    'i'
  );
  definition := regexp_replace(
    definition,
    '[[:space:]]*receipt_ids jsonb;',
    '',
    'i'
  );

  block_start := strpos(definition, '  if external_document is not null then');
  block_end := strpos(definition, artifact_validation_marker);
  if block_start = 0 or block_end = 0 or block_end <= block_start then
    raise exception 'finalize_verified_authoring_external_validation_block_not_found';
  end if;
  definition :=
    substring(definition from 1 for block_start - 1)
    || substring(definition from block_end);

  block_start := strpos(definition, '  if external_document is not null then');
  block_end := strpos(definition, return_marker);
  if block_start = 0 or block_end = 0 or block_end <= block_start then
    raise exception 'finalize_verified_authoring_external_completion_block_not_found';
  end if;
  definition :=
    substring(definition from 1 for block_start - 1)
    || substring(definition from block_end);

  definition := replace(
    definition,
    E'    execution_driver = run_document->>''executionDriver'',\n',
    ''
  );

  if position('external_document' in definition) > 0
    or position('external_authoring' in definition) > 0
    or position('staged_blob_receipts' in definition) > 0
    or position('execution_driver' in definition) > 0 then
    raise exception 'finalize_verified_authoring_mcp_removal_failed';
  end if;
  execute definition;
end;
$$;

drop function public.finalize_verified_authoring(
  text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
);
revoke all on function public.finalize_verified_authoring(
  text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
) from public, anon, authenticated;
grant execute on function public.finalize_verified_authoring(
  text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
) to service_role;

drop function if exists public.claim_next_external_authoring(
  text,text,text,text,timestamptz,timestamptz
);
drop function if exists public.requeue_external_authoring_execution(
  text,timestamptz
);
drop function if exists public.expire_external_authoring_execution_deadlines(
  timestamptz
);
drop function if exists public.cancel_external_authoring_batch(
  text,timestamptz
);
drop function if exists public.reserve_external_authoring_operation(
  jsonb,integer,text
);
drop function if exists public.complete_external_authoring_operation(
  text,text,jsonb,text,text,text
);
drop function if exists public.fail_external_authoring_operation(
  text,text,text,jsonb
);

alter table public.external_authoring_executions
  drop constraint if exists external_authoring_executions_current_operation_fk;
drop table public.external_authoring_credential_requests;
drop table public.external_authoring_credentials;
drop table public.external_authoring_operations;
drop table public.external_authoring_claims;
drop table public.external_authoring_executions;
drop table public.authoring_execution_bundles;
drop table public.staged_blob_receipts;

drop view public.site_agent_run_admin_inventory;
drop index public.site_agent_runs_claim_queue_idx;

-- Rebuild the canonical queue functions before removing the obsolete
-- discriminator column so every live function is single-path.
create or replace function public.enqueue_site_agent_run(run_document jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_owner uuid;
begin
  if run_document ? 'executionDriver'
    or run_document ? 'externalProvenance'
    or run_document ? 'authoringExecutionBundleId'
    or run_document#>'{usage}' ? 'kind'
    or nullif(run_document->>'apiProvider', '') is null
    or nullif(run_document->>'modelId', '') is null then
    raise exception 'invalid_site_agent_run_contract';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('site-authoring-maintenance-claim-fence', 0)
  );
  if exists (
    select 1 from public.site_agent_maintenance_leases
    where task = 'site_authoring_maintenance'
      and lease_until > now()
  ) then
    raise exception 'site_authoring_maintenance_active';
  end if;

  select owner_user_id into target_owner
    from public.sites
    where id = run_document->>'siteId';
  if target_owner is not null then
    perform pg_advisory_xact_lock(hashtextextended(target_owner::text, 0));
    if public.private_user_active_operation_count(target_owner) >= 3 then
      raise exception 'concurrent_project_limit';
    end if;
  end if;

  insert into public.site_agent_runs (
    id, session_id, site_id, schema_version, kind, status,
    exact_parent_revision_id, output_revision_id, api_provider, model_id,
    run, started_at, completed_at
  ) values (
    run_document->>'id',
    run_document->>'sessionId',
    run_document->>'siteId',
    run_document->>'schemaVersion',
    run_document->>'kind',
    run_document->>'status',
    nullif(run_document->>'exactParentRevisionId', ''),
    nullif(run_document->>'outputRevisionId', ''),
    run_document->>'apiProvider',
    run_document->>'modelId',
    run_document,
    (run_document->>'startedAt')::timestamptz,
    nullif(run_document->>'completedAt', '')::timestamptz
  );
  return run_document;
end;
$$;

create or replace function public.save_site_agent_run(run_document jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_run public.site_agent_runs;
  current_execution integer;
  requested_execution integer;
  transition_allowed boolean;
begin
  if run_document ? 'executionDriver'
    or run_document ? 'externalProvenance'
    or run_document ? 'authoringExecutionBundleId'
    or run_document#>'{usage}' ? 'kind'
    or nullif(run_document->>'apiProvider', '') is null
    or nullif(run_document->>'modelId', '') is null then
    raise exception 'invalid_site_agent_run_contract';
  end if;

  select * into current_run
    from public.site_agent_runs
    where id = run_document->>'id'
    for update;
  if current_run.id is null then
    raise exception 'site_agent_run_missing';
  end if;

  current_execution :=
    coalesce((current_run.run->>'executionNumber')::integer, 0);
  requested_execution :=
    coalesce((run_document->>'executionNumber')::integer, 0);
  transition_allowed := current_execution = requested_execution and (
    (
      current_run.status = 'queued'
      and run_document->>'status' in ('queued', 'cancelled')
    )
    or current_run.status = 'running'
    or (
      current_run.status = 'needs_input'
      and run_document->>'status'
        in ('needs_input', 'queued', 'running', 'failed', 'cancelled')
    )
  );
  if not transition_allowed then
    return current_run.run;
  end if;

  update public.site_agent_runs set
    session_id = run_document->>'sessionId',
    site_id = run_document->>'siteId',
    schema_version = run_document->>'schemaVersion',
    kind = run_document->>'kind',
    status = run_document->>'status',
    exact_parent_revision_id =
      nullif(run_document->>'exactParentRevisionId', ''),
    output_revision_id = nullif(run_document->>'outputRevisionId', ''),
    api_provider = run_document->>'apiProvider',
    model_id = run_document->>'modelId',
    run = run_document,
    started_at = (run_document->>'startedAt')::timestamptz,
    completed_at = nullif(run_document->>'completedAt', '')::timestamptz
    where id = current_run.id;
  return run_document;
end;
$$;

create or replace function public.claim_site_agent_run(target_run_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_run public.site_agent_runs;
  claimed_at timestamptz := now();
  next_execution integer;
  run_value jsonb;
  active_count integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('site-authoring-maintenance-claim-fence', 0)
  );
  if exists (
    select 1 from public.site_agent_maintenance_leases
    where task = 'site_authoring_maintenance'
      and lease_until > claimed_at
  ) then
    return null;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('site-agent-global-capacity', 0)
  );
  select count(*) into active_count
    from public.site_agent_runs
    where status = 'running';
  if active_count >= 4 then return null; end if;

  select * into selected_run
    from public.site_agent_runs
    where id = target_run_id
      and status = 'queued'
    for update;
  if selected_run.id is null then return null; end if;
  if exists (
    select 1 from public.site_agent_runs active
    where active.site_id = selected_run.site_id
      and active.status = 'running'
  ) then
    return null;
  end if;

  next_execution :=
    coalesce((selected_run.run->>'executionNumber')::integer, 0) + 1;
  run_value := selected_run.run;
  run_value := jsonb_set(run_value, '{status}', '"running"', true);
  run_value := jsonb_set(
    run_value,
    '{stage}',
    case
      when run_value#>>'{request,kind}' = 'initial_build'
        then '"retrieving_sources"'::jsonb
      else '"authoring"'::jsonb
    end,
    true
  );
  run_value := jsonb_set(
    run_value,
    '{executionNumber}',
    to_jsonb(next_execution),
    true
  );
  run_value := jsonb_set(
    run_value,
    '{heartbeatAt}',
    to_jsonb(
      to_char(
        claimed_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    ),
    true
  );

  update public.site_agent_runs set
    status = 'running',
    run = run_value,
    completed_at = null
    where id = selected_run.id
      and status = 'queued'
    returning * into selected_run;
  return selected_run.run;
end;
$$;

-- Keep the proven coalescing/fencing implementation and remove only its five
-- obsolete driver predicates.
do $$
declare
  definition text;
begin
  select pg_get_functiondef(
    'public.claim_next_site_agent_run(text,timestamptz)'::regprocedure
  ) into definition;
  definition := replace(
    definition,
    E'\n      and execution_driver = ''responses_api''',
    ''
  );
  definition := replace(
    definition,
    E'\n      and candidate.execution_driver = ''responses_api''',
    ''
  );
  definition := replace(
    definition,
    E'\n        and candidate.execution_driver = ''responses_api''',
    ''
  );
  definition := replace(
    definition,
    E'\n        and coalesced.execution_driver = ''responses_api''',
    ''
  );
  definition := replace(
    definition,
    E'\n            and barrier.execution_driver = ''responses_api''',
    ''
  );
  if position('execution_driver' in definition) > 0 then
    raise exception 'claim_next_site_agent_run_mcp_removal_failed';
  end if;
  execute definition;
end;
$$;

alter table public.site_agent_runs
  drop column execution_driver;
alter table public.site_agent_runs
  alter column api_provider set not null,
  alter column model_id set not null;

create index site_agent_runs_claim_queue_idx
  on public.site_agent_runs(started_at, id)
  where status = 'queued';

create view public.site_agent_run_admin_inventory
with (security_invoker = true)
as
select
  runs.id,
  runs.schema_version,
  runs.site_id,
  sites.slug as site_slug,
  runs.status,
  runs.started_at,
  runs.completed_at,
  runs.kind,
  runs.api_provider,
  runs.model_id,
  runs.run ->> 'stage' as stage,
  runs.run #>> '{usage,costSource}' as cost_source,
  runs.run ->> 'failureCode' as failure_code,
  runs.run ->> 'failureCategory' as failure_category,
  runs.run ->> 'failureReason' as failure_reason,
  case
    when jsonb_typeof(runs.run) <> 'object'
      or runs.run ->> 'schemaVersion' is distinct from 'site-agent-run'
      then 'stale schema - rebuild'
    else null
  end as issue,
  case
    when runs.run #>> '{usage,costSource}' <> 'unavailable'
      and jsonb_typeof(runs.run #> '{usage,costUsd}') = 'number'
      then (runs.run #>> '{usage,costUsd}')::numeric
    else null
  end as cost_usd,
  case
    when jsonb_typeof(runs.run #> '{usage,durationMs}') = 'number'
      then (runs.run #>> '{usage,durationMs}')::bigint
    else null
  end as duration_ms,
  case
    when jsonb_typeof(runs.run #> '{usage,inputTokens}') = 'number'
      or jsonb_typeof(runs.run #> '{usage,outputTokens}') = 'number'
      then
        coalesce(
          case
            when jsonb_typeof(runs.run #> '{usage,inputTokens}') = 'number'
              then (runs.run #>> '{usage,inputTokens}')::bigint
          end,
          0
        )
        + coalesce(
          case
            when jsonb_typeof(runs.run #> '{usage,outputTokens}') = 'number'
              then (runs.run #>> '{usage,outputTokens}')::bigint
          end,
          0
        )
    else null
  end as token_count,
  concat_ws(
    ' ',
    runs.id,
    runs.site_id,
    sites.slug,
    runs.model_id,
    runs.api_provider,
    runs.kind,
    runs.run ->> 'failureCode'
  ) as search_text
from public.site_agent_runs as runs
left join public.sites as sites on sites.id = runs.site_id;

revoke all on function public.enqueue_site_agent_run(jsonb)
  from public, anon, authenticated;
grant execute on function public.enqueue_site_agent_run(jsonb)
  to service_role;
revoke all on function public.save_site_agent_run(jsonb)
  from public, anon, authenticated;
grant execute on function public.save_site_agent_run(jsonb)
  to service_role;
revoke all on function public.claim_site_agent_run(text)
  from public, anon, authenticated;
grant execute on function public.claim_site_agent_run(text)
  to service_role;
revoke all on function public.claim_next_site_agent_run(text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_next_site_agent_run(text,timestamptz)
  to service_role;
revoke all on table public.site_agent_run_admin_inventory
  from public, anon, authenticated;
grant select on table public.site_agent_run_admin_inventory
  to service_role;

commit;
