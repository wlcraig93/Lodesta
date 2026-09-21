alter table public.site_agent_sessions
  drop constraint site_agent_sessions_sandbox_provider_check;

update public.site_agent_sessions
set sandbox_provider = 'railway',
    session = jsonb_set(session, '{sandboxProvider}', '"railway"')
where sandbox_provider = 'cloudflare'
   or session->>'sandboxProvider' = 'cloudflare';

alter table public.site_agent_sessions
  add constraint site_agent_sessions_sandbox_provider_check
  check (sandbox_provider = 'railway');

alter table public.site_agent_workspace_checkpoints
  drop constraint site_agent_workspace_checkpoints_sandbox_deployment_id_fkey,
  alter column sandbox_deployment_id drop not null;

create or replace function public.claim_site_agent_run(
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
  run_value := run_value - 'sandboxDeploymentId';
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
    sandbox_deployment_id = null,
    resume_checkpoint_id = case when checkpoint_current then target_run.resume_checkpoint_id else null end,
    run = run_value,
    completed_at = null
    where candidate.id = target_run.id and candidate.status = 'queued'
    returning candidate.* into target_run;
  if target_run.id is null then return null; end if;
  return target_run.run;
end;
$$;
