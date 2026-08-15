-- Keep operator/local targeted claims aligned with the durable queue claimant.
-- `claimed_at` is also a maintenance-lease column, so use an unambiguous
-- PL/pgSQL variable name throughout the function.

begin;

create or replace function public.claim_site_agent_run(target_run_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_run public.site_agent_runs;
  claim_time timestamptz := now();
  next_execution integer;
  run_value jsonb;
  active_count integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('site-authoring-maintenance-claim-fence', 0)
  );
  if exists (
    select 1 from public.site_agent_maintenance_leases maintenance_lease
    where maintenance_lease.task = 'site_authoring_maintenance'
      and maintenance_lease.lease_until > claim_time
  ) then
    return null;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('site-agent-global-capacity', 0)
  );
  select count(*) into active_count
    from public.site_agent_runs candidate
    where candidate.status = 'running';
  if active_count >= 4 then return null; end if;

  select * into selected_run
    from public.site_agent_runs candidate
    where candidate.id = target_run_id
      and candidate.status = 'queued'
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
        claim_time at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    ),
    true
  );

  update public.site_agent_runs candidate set
    status = 'running',
    run = run_value,
    completed_at = null
    where candidate.id = selected_run.id
      and candidate.status = 'queued'
    returning candidate.* into selected_run;
  return selected_run.run;
end;
$$;

revoke all on function public.claim_site_agent_run(text)
  from public, anon, authenticated;
grant execute on function public.claim_site_agent_run(text)
  to service_role;

commit;
