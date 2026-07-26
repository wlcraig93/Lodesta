create or replace function acquire_site_agent_maintenance(task_name text, lease_token_hash_value text, lease_until_value timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if task_name = 'site_authoring_maintenance' then
    perform pg_advisory_xact_lock(hashtextextended('site-authoring-maintenance-claim-fence', 0));
  end if;
  insert into site_agent_maintenance_leases(task, lease_token_hash, lease_until, claimed_at)
    values (task_name, lease_token_hash_value, lease_until_value, now())
    on conflict (task) do update set
      lease_token_hash = excluded.lease_token_hash, lease_until = excluded.lease_until, claimed_at = now()
    where site_agent_maintenance_leases.lease_until <= now();
  return found;
end;
$$;

create or replace function enqueue_site_agent_run(run_document jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare target_owner uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('site-authoring-maintenance-claim-fence', 0));
  if exists (
    select 1 from site_agent_maintenance_leases
    where task = 'site_authoring_maintenance' and lease_until > now()
  ) then raise exception 'site_authoring_maintenance_active'; end if;
  select owner_user_id into target_owner from sites where id = run_document->>'siteId';
  if target_owner is not null then
    perform pg_advisory_xact_lock(hashtextextended(target_owner::text, 0));
    if private_user_active_operation_count(target_owner) >= 3 then
      raise exception 'concurrent_project_limit';
    end if;
  end if;
  insert into site_agent_runs (
    id, session_id, site_id, schema_version, kind, status, exact_parent_revision_id,
    output_revision_id, execution_driver, api_provider, model_id, run, started_at, completed_at
  ) values (
    run_document->>'id', run_document->>'sessionId', run_document->>'siteId',
    run_document->>'schemaVersion', run_document->>'kind', run_document->>'status',
    run_document->>'exactParentRevisionId', run_document->>'outputRevisionId',
    coalesce(run_document->>'executionDriver', 'responses_api'),
    run_document->>'apiProvider', run_document->>'modelId', run_document,
    (run_document->>'startedAt')::timestamptz,
    nullif(run_document->>'completedAt', '')::timestamptz
  );
  return run_document;
end;
$$;

create or replace function claim_site_agent_run(target_run_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_run jsonb;
  api_active integer;
  external_active integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('site-authoring-maintenance-claim-fence', 0));
  if exists (
    select 1 from site_agent_maintenance_leases
    where task = 'site_authoring_maintenance' and lease_until > now()
  ) then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('site-agent-global-capacity', 0));
  if exists (
    select 1 from site_agent_maintenance_leases
    where task = 'site_authoring_maintenance' and lease_until > now()
  ) then return null; end if;
  select count(*) into api_active from site_agent_runs
    where status = 'running' and execution_driver = 'responses_api';
  select count(*) into external_active from external_authoring_operations
    where status in ('reserved','running') and tool_name in ('build_preview','inspect_site','finish');
  if api_active + external_active >= 4 then return null; end if;
  update site_agent_runs
    set status = 'running',
      run = jsonb_set(
        jsonb_set(
          jsonb_set(run, '{status}', '"running"', true),
          '{stage}', '"authoring"', true
        ),
        '{executionNumber}', to_jsonb(coalesce((run->>'executionNumber')::integer, 0) + 1), true
      )
    where id = target_run_id
      and status = 'queued'
      and execution_driver = 'responses_api'
    returning run into target_run;
  return target_run;
end;
$$;

create or replace function claim_next_external_authoring(
  target_claim_id text,
  target_binding_id text,
  target_worker_key_hash text,
  target_capability_hash text,
  target_lease_expires_at timestamptz,
  target_deadline_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_execution external_authoring_executions;
  target_generation integer;
  target_claim external_authoring_claims;
  maintenance_active boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('site-authoring-maintenance-claim-fence', 0));
  perform pg_advisory_xact_lock(hashtextextended('external-authoring-claim', 0));
  select exists (
    select 1 from site_agent_maintenance_leases
    where task = 'site_authoring_maintenance' and lease_until > now()
  ) into maintenance_active;

  update external_authoring_operations o set
    status = 'cancelled', error_code = 'claim_lease_expired', completed_at = now(), updated_at = now()
    where o.status in ('reserved','running')
      and exists (
        select 1 from external_authoring_claims c
        where c.id = o.claim_id and c.status = 'active'
          and greatest(c.lease_expires_at, coalesce(c.operation_deadline_at, c.lease_expires_at)) <= now()
      );
  update external_authoring_executions e set
    status = 'queued', current_operation_id = null, updated_at = now()
    where e.status in ('claimed','authoring','finalizing')
      and exists (
        select 1 from external_authoring_claims c
        where c.execution_id = e.id and c.status = 'active'
          and greatest(c.lease_expires_at, coalesce(c.operation_deadline_at, c.lease_expires_at)) <= now()
      );
  update site_agent_runs r set
    status = 'queued',
    run = jsonb_set(jsonb_set(r.run, '{status}', '"queued"', true), '{stage}', '"queued"', true)
    where r.id in (
      select e.run_id from external_authoring_executions e
      join external_authoring_claims c on c.execution_id = e.id
      where c.status = 'active'
        and greatest(c.lease_expires_at, coalesce(c.operation_deadline_at, c.lease_expires_at)) <= now()
    ) and r.status = 'running';
  update external_authoring_claims set
    status = 'fenced', operation_deadline_at = null, last_activity_at = now(), updated_at = now()
    where status = 'active'
      and greatest(lease_expires_at, coalesce(operation_deadline_at, lease_expires_at)) <= now();

  select c.* into target_claim
  from external_authoring_claims c
  join external_authoring_executions e on e.id = c.execution_id
  where c.binding_id = target_binding_id
    and c.worker_key_hash = target_worker_key_hash
    and c.status = 'active'
    and greatest(c.lease_expires_at, coalesce(c.operation_deadline_at, c.lease_expires_at)) > now()
    and (
      e.status in ('claimed','authoring','finalizing')
      or (not maintenance_active and e.status = 'needs_input')
    )
  order by c.updated_at desc
  limit 1
  for update of c;
  if target_claim.id is not null then
    update external_authoring_claims
      set lease_expires_at = target_lease_expires_at, last_activity_at = now(), updated_at = now()
      where id = target_claim.id;
    update external_authoring_executions set last_activity_at = now(), updated_at = now()
      where id = target_claim.execution_id;
    return jsonb_build_object('claimId', target_claim.id, 'executionId', target_claim.execution_id, 'leaseGeneration', target_claim.lease_generation, 'reattached', true);
  end if;

  if maintenance_active then return null; end if;

  select e.* into target_execution
  from external_authoring_executions e
  join external_authoring_batch_items i on i.id = e.batch_item_id
  join external_authoring_batches b on b.id = i.batch_id
  where e.status = 'queued' and i.preparation_status = 'completed' and b.cancel_requested_at is null
  order by e.created_at
  limit 1
  for update of e skip locked;
  if target_execution.id is null then return null; end if;

  select coalesce(max(lease_generation), 0) + 1 into target_generation
    from external_authoring_claims where execution_id = target_execution.id;
  insert into external_authoring_claims (
    id, execution_id, schema_version, binding_id, worker_key_hash, capability_hash,
    lease_generation, status, lease_expires_at, last_activity_at, created_at, updated_at
  ) values (
    target_claim_id, target_execution.id, 1, target_binding_id, target_worker_key_hash,
    target_capability_hash, target_generation, 'active', target_lease_expires_at, now(), now(), now()
  );
  update external_authoring_executions set
    status = 'claimed', claimed_at = coalesce(claimed_at, now()), last_activity_at = now(),
    deadline_at = coalesce(deadline_at, target_deadline_at), updated_at = now()
    where id = target_execution.id;
  update site_agent_runs set
    status = 'running',
    run = jsonb_set(jsonb_set(run, '{status}', '"running"', true), '{stage}', '"authoring"', true)
    where id = target_execution.run_id and status = 'queued';
  return jsonb_build_object('claimId', target_claim_id, 'executionId', target_execution.id, 'leaseGeneration', target_generation, 'reattached', false);
end;
$$;
