create or replace view public.site_agent_run_admin_inventory
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
  runs.execution_driver,
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
          case when jsonb_typeof(runs.run #> '{usage,inputTokens}') = 'number'
            then (runs.run #>> '{usage,inputTokens}')::bigint
          end,
          0
        )
        + coalesce(
          case when jsonb_typeof(runs.run #> '{usage,outputTokens}') = 'number'
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
    runs.execution_driver,
    runs.kind,
    runs.run ->> 'failureCode'
  ) as search_text
from public.site_agent_runs as runs
left join public.sites as sites on sites.id = runs.site_id;

revoke all on table public.site_agent_run_admin_inventory from public, anon, authenticated;
grant select on table public.site_agent_run_admin_inventory to service_role;
