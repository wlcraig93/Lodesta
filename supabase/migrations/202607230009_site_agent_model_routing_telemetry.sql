alter table site_agent_runs
  add column api_provider text;

update site_agent_runs
set
  api_provider = 'openai',
  run = jsonb_set(
    jsonb_set(run, '{apiProvider}', '"openai"', true),
    '{usage}',
    (
      coalesce(run->'usage', '{}'::jsonb)
      - 'estimatedCostUsd'
      - 'costEstimateStatus'
    ) || jsonb_build_object(
      'reasoningTokens', 0,
      'costUsd', coalesce((run#>>'{usage,estimatedCostUsd}')::numeric, 0),
      'costSource', case
        when run#>>'{usage,costEstimateStatus}' = 'configured' then 'catalog_estimate'
        else 'unavailable'
      end,
      'upstreamInferenceCostUsd', 0
    ),
    true
  );

alter table site_agent_runs
  alter column api_provider set not null,
  add constraint site_agent_runs_api_provider_check
    check (api_provider in ('openai', 'openrouter'));

create index site_agent_runs_provider_started_idx
  on site_agent_runs(api_provider, started_at desc);

alter table site_agent_run_events
  add column api_provider text,
  add column served_model_id text,
  add column upstream_provider text,
  add column provider_request_id text,
  add column reasoning_tokens integer,
  add column cost_usd numeric(20, 10),
  add column cost_source text,
  add column upstream_inference_cost_usd numeric(20, 10),
  add column model_duration_ms bigint,
  add constraint site_agent_run_events_api_provider_check
    check (api_provider is null or api_provider in ('openai', 'openrouter')),
  add constraint site_agent_run_events_cost_source_check
    check (cost_source is null or cost_source in ('provider_reported', 'catalog_estimate', 'mixed', 'unavailable')),
  add constraint site_agent_run_events_reasoning_tokens_check
    check (reasoning_tokens is null or reasoning_tokens >= 0),
  add constraint site_agent_run_events_cost_usd_check
    check (cost_usd is null or cost_usd >= 0),
  add constraint site_agent_run_events_upstream_cost_usd_check
    check (upstream_inference_cost_usd is null or upstream_inference_cost_usd >= 0),
  add constraint site_agent_run_events_model_duration_ms_check
    check (model_duration_ms is null or model_duration_ms >= 0);

update site_agent_run_events
set api_provider = 'openai'
where kind = 'model_request';

create index site_agent_run_events_run_sequence_idx
  on site_agent_run_events(run_id, sequence);

create index site_agent_run_events_provider_started_idx
  on site_agent_run_events(api_provider, started_at desc)
  where kind = 'model_request';

update operator_settings
set
  value = jsonb_set(value, '{siteAgentProvider}', '"openai"', true),
  version = version + 1,
  updated_by = 'migration:202607230009',
  updated_at = now()
where key = 'site_authoring_models'
  and not (value ? 'siteAgentProvider');

create or replace function enqueue_site_agent_run(run_document jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare target_owner uuid;
begin
  select owner_user_id into target_owner from sites where id = run_document->>'siteId';
  if target_owner is not null then
    perform pg_advisory_xact_lock(hashtextextended(target_owner::text, 0));
    if private_user_active_operation_count(target_owner) >= 3 then
      raise exception 'concurrent_project_limit';
    end if;
  end if;
  insert into site_agent_runs (
    id, session_id, site_id, schema_version, kind, status, exact_parent_revision_id,
    output_revision_id, api_provider, model_id, run, started_at, completed_at
  ) values (
    run_document->>'id', run_document->>'sessionId', run_document->>'siteId',
    run_document->>'schemaVersion', run_document->>'kind', run_document->>'status',
    run_document->>'exactParentRevisionId', run_document->>'outputRevisionId',
    run_document->>'apiProvider', run_document->>'modelId', run_document,
    (run_document->>'startedAt')::timestamptz,
    nullif(run_document->>'completedAt', '')::timestamptz
  );
  return run_document;
end;
$$;
