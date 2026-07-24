-- External Codex authoring is a pre-launch clean cut. Raw preview secrets may not
-- cross this migration; run the stored-data report/cutover command first.
do $$
declare retained_raw_preview_links boolean;
begin
  if to_regclass('public.preview_tokens') is not null then
    if exists (select 1 from preview_tokens) then
      raise exception 'preview_token_cutover_required: revoke/regenerate retained previews before migration';
    end if;
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public' and table_name = 'outbound_prospects' and column_name = 'preview_token'
    ) then
      execute 'select exists (select 1 from outbound_prospects where preview_token is not null)'
        into retained_raw_preview_links;
      if retained_raw_preview_links then
        raise exception 'preview_token_cutover_required: clear retained outbound raw-token links before migration';
      end if;
    end if;
    execute 'drop table preview_tokens';
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'outbound_prospects' and column_name = 'preview_token'
  ) then
    alter table outbound_prospects drop column preview_token;
  end if;
end $$;

create table if not exists preview_grants (
  id text primary key,
  site_id text not null references sites(id) on delete restrict,
  site_version_id text not null references site_versions(id) on delete restrict,
  secret_hash text not null check (secret_hash ~ '^sha256:[a-f0-9]{64}$'),
  key_version text not null,
  secret_version integer not null default 1 check (secret_version > 0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists preview_grants_site_idx on preview_grants(site_id, created_at desc);

alter table outbound_prospects add column if not exists preview_id text references preview_grants(id) on delete restrict;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'site_agent_sessions' and column_name = 'owner_id'
  ) then
    alter table site_agent_sessions add column principal_kind text;
    alter table site_agent_sessions add column principal_id text;
    update site_agent_sessions
      set principal_kind = 'owner', principal_id = owner_id::text
      where principal_kind is null;
    alter table site_agent_sessions alter column principal_kind set not null;
    alter table site_agent_sessions alter column principal_id set not null;
    alter table site_agent_sessions drop column owner_id;
  end if;
end $$;
alter table site_agent_sessions drop constraint if exists site_agent_sessions_principal_kind_check;
alter table site_agent_sessions
  add constraint site_agent_sessions_principal_kind_check check (principal_kind in ('owner', 'operator'));
create index if not exists site_agent_sessions_principal_idx
  on site_agent_sessions(site_id, principal_kind, principal_id, updated_at desc);

alter table site_agent_runs add column if not exists execution_driver text;
update site_agent_runs
set
  execution_driver = coalesce(execution_driver, 'responses_api'),
  run = jsonb_set(
    jsonb_set(run, '{executionDriver}', '"responses_api"', true),
    '{usage,kind}', '"model_reported"', true
  )
where execution_driver is null or not (run ? 'executionDriver') or not (coalesce(run->'usage', '{}'::jsonb) ? 'kind');
alter table site_agent_runs alter column execution_driver set not null;
alter table site_agent_runs alter column api_provider drop not null;
alter table site_agent_runs alter column model_id drop not null;
alter table site_agent_runs drop constraint if exists site_agent_runs_execution_driver_check;
alter table site_agent_runs
  add constraint site_agent_runs_execution_driver_check
  check (
    (execution_driver = 'responses_api' and api_provider is not null and model_id is not null)
    or (execution_driver = 'external_mcp' and api_provider is null and model_id is null)
  );

create table external_authoring_batches (
  id text primary key,
  schema_version integer not null check (schema_version = 1),
  name text not null,
  requested_by text not null,
  campaign_id text not null references outbound_campaigns(id) on delete restrict,
  reference_asset_preview_policy_accepted_at timestamptz not null,
  cancel_requested_at timestamptz,
  created_at timestamptz not null
);

create table external_authoring_batch_items (
  id text primary key,
  batch_id text not null references external_authoring_batches(id) on delete restrict,
  schema_version integer not null check (schema_version = 1),
  ordinal integer not null check (ordinal >= 0),
  source_url text not null,
  normalized_source text not null,
  business_name_hint text,
  preparation_key text not null unique check (preparation_key ~ '^sha256:[a-f0-9]{64}$'),
  preparation_status text not null check (preparation_status in ('queued', 'running', 'completed', 'failed')),
  preparation_attempts integer not null default 0 check (preparation_attempts >= 0),
  preparation_locked_by text,
  preparation_locked_at timestamptz,
  preparation_failure_code text,
  preparation_failure_reason text,
  site_id text references sites(id) on delete restrict,
  prospect_id text references outbound_prospects(id) on delete restrict,
  session_id text references site_agent_sessions(id) on delete restrict,
  run_id text references site_agent_runs(id) on delete restrict,
  candidate_version_id text references site_versions(id) on delete restrict,
  preview_id text references preview_grants(id) on delete restrict,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (batch_id, ordinal)
);
create index external_authoring_batch_items_queue_idx
  on external_authoring_batch_items(created_at)
  where preparation_status in ('queued', 'running');

create or replace function claim_external_batch_preparation(target_worker_id text)
returns setof external_authoring_batch_items
language plpgsql
security definer
set search_path = public
as $$
declare target_id text;
begin
  select i.id into target_id
  from external_authoring_batch_items i
  join external_authoring_batches b on b.id = i.batch_id
  where b.cancel_requested_at is null
    and (
      i.preparation_status = 'queued'
      or (
        i.preparation_status = 'running'
        and i.preparation_locked_at < now() - interval '30 minutes'
      )
    )
  order by i.created_at, i.ordinal
  for update of i skip locked
  limit 1;
  if target_id is null then return; end if;
  return query update external_authoring_batch_items set
    preparation_status = 'running',
    preparation_attempts = preparation_attempts + 1,
    preparation_locked_by = target_worker_id,
    preparation_locked_at = now(),
    preparation_failure_code = null,
    preparation_failure_reason = null,
    updated_at = now()
    where id = target_id returning *;
end;
$$;

create table authoring_execution_bundles (
  id text primary key,
  run_id text not null unique references site_agent_runs(id) on delete restrict,
  schema_version integer not null check (schema_version = 1),
  bundle_hash text not null check (bundle_hash ~ '^sha256:[a-f0-9]{64}$'),
  instruction_version text not null,
  instruction_hash text not null check (instruction_hash ~ '^sha256:[a-f0-9]{64}$'),
  skill_contract_version text not null,
  skill_contract_hash text not null check (skill_contract_hash ~ '^sha256:[a-f0-9]{64}$'),
  public_build_input_id text not null references site_public_build_inputs(id) on delete restrict,
  public_build_input_hash text not null check (public_build_input_hash ~ '^sha256:[a-f0-9]{64}$'),
  source_policy_version text not null,
  source_policy_hash text not null check (source_policy_hash ~ '^sha256:[a-f0-9]{64}$'),
  verification_policy_version text not null,
  verification_policy_hash text not null check (verification_policy_hash ~ '^sha256:[a-f0-9]{64}$'),
  tool_schema_hash text not null check (tool_schema_hash ~ '^sha256:[a-f0-9]{64}$'),
  toolchain_version text not null,
  sandbox_image_digest text not null check (sandbox_image_digest ~ '^sha256:[a-f0-9]{64}$'),
  bundle jsonb not null,
  created_at timestamptz not null
);

create table external_authoring_executions (
  id text primary key,
  run_id text not null unique references site_agent_runs(id) on delete restrict,
  batch_item_id text not null unique references external_authoring_batch_items(id) on delete restrict,
  bundle_id text references authoring_execution_bundles(id) on delete restrict,
  schema_version integer not null check (schema_version = 1),
  status text not null check (status in ('queued', 'claimed', 'needs_input', 'authoring', 'finalizing', 'completed', 'failed', 'cancelled')),
  state_revision integer not null default 0 check (state_revision >= 0),
  workspace_hash text check (workspace_hash is null or workspace_hash ~ '^sha256:[a-f0-9]{64}$'),
  checkpoint_key text,
  checkpoint_hash text check (checkpoint_hash is null or checkpoint_hash ~ '^sha256:[a-f0-9]{64}$'),
  current_operation_id text,
  finalization_key text unique check (finalization_key is null or finalization_key ~ '^sha256:[a-f0-9]{64}$'),
  finalization_result jsonb,
  claimed_at timestamptz,
  last_activity_at timestamptz,
  deadline_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create index external_authoring_executions_queue_idx
  on external_authoring_executions(created_at)
  where status = 'queued';

create table external_authoring_claims (
  id text primary key,
  execution_id text not null references external_authoring_executions(id) on delete restrict,
  schema_version integer not null check (schema_version = 1),
  binding_id text not null,
  worker_key_hash text not null check (worker_key_hash ~ '^sha256:[a-f0-9]{64}$'),
  capability_hash text not null check (capability_hash ~ '^sha256:[a-f0-9]{64}$'),
  lease_generation integer not null check (lease_generation > 0),
  status text not null check (status in ('active', 'released', 'fenced')),
  lease_expires_at timestamptz not null,
  operation_deadline_at timestamptz,
  last_activity_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (execution_id, lease_generation)
);
create unique index external_authoring_claims_active_execution_idx
  on external_authoring_claims(execution_id) where status = 'active';
create index external_authoring_claims_binding_idx
  on external_authoring_claims(binding_id, worker_key_hash, updated_at desc);

create table external_authoring_operations (
  id text primary key,
  execution_id text not null references external_authoring_executions(id) on delete restrict,
  claim_id text not null references external_authoring_claims(id) on delete restrict,
  schema_version integer not null check (schema_version = 1),
  lease_generation integer not null check (lease_generation > 0),
  operation_key text not null unique check (operation_key ~ '^sha256:[a-f0-9]{64}$'),
  idempotency_key_hash text not null check (idempotency_key_hash ~ '^sha256:[a-f0-9]{64}$'),
  tool_name text not null check (tool_name in ('list_files','read_file','write_file','delete_file','apply_patch','build_preview','inspect_site','request_input','finish')),
  arguments_hash text not null check (arguments_hash ~ '^sha256:[a-f0-9]{64}$'),
  pre_state_revision integer not null check (pre_state_revision >= 0),
  post_state_revision integer check (post_state_revision is null or post_state_revision >= 0),
  pre_workspace_hash text,
  post_workspace_hash text,
  status text not null check (status in ('reserved','running','succeeded','failed','cancelled')),
  result jsonb,
  error_code text,
  deadline_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  unique (claim_id, lease_generation, idempotency_key_hash)
);
alter table external_authoring_executions
  add constraint external_authoring_executions_current_operation_fk
  foreign key (current_operation_id) references external_authoring_operations(id) on delete restrict;
create index external_authoring_operations_active_idx
  on external_authoring_operations(tool_name, created_at)
  where status in ('reserved', 'running');

create table external_authoring_credentials (
  id text primary key,
  schema_version integer not null check (schema_version = 1),
  token_hash text not null unique check (token_hash ~ '^sha256:[a-f0-9]{64}$'),
  label text not null,
  status text not null check (status in ('active', 'revoked')),
  created_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz
);

create table external_authoring_credential_requests (
  id bigint generated always as identity primary key,
  credential_id text not null references external_authoring_credentials(id) on delete restrict,
  tool_name text,
  accepted boolean not null,
  occurred_at timestamptz not null default now()
);
create index external_authoring_credential_requests_rate_idx
  on external_authoring_credential_requests(credential_id, occurred_at desc);

create table staged_blob_receipts (
  id text primary key,
  schema_version integer not null check (schema_version = 1),
  storage_key text not null,
  content_hash text not null check (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  bytes bigint not null check (bytes >= 0),
  etag text not null,
  finalization_key text check (finalization_key is null or finalization_key ~ '^sha256:[a-f0-9]{64}$'),
  staged_at timestamptz not null,
  consumed_at timestamptz,
  unique (storage_key, content_hash)
);

create table authoring_outbox (
  id text primary key,
  schema_version integer not null check (schema_version = 1),
  event_type text not null check (event_type = 'site_candidate_finalized'),
  aggregate_id text not null,
  payload jsonb not null,
  status text not null check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  run_after timestamptz not null,
  locked_by text,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null,
  completed_at timestamptz,
  unique (event_type, aggregate_id)
);
create index authoring_outbox_queue_idx on authoring_outbox(run_after, created_at)
  where status in ('pending', 'processing');

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
begin
  perform pg_advisory_xact_lock(hashtextextended('external-authoring-claim', 0));

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
    and e.status in ('claimed','authoring','needs_input','finalizing')
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

create or replace function requeue_external_authoring_execution(
  target_execution_id text,
  target_requeued_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare target_run_id text;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_execution_id, 0));
  select run_id into target_run_id from external_authoring_executions
    where id = target_execution_id and status not in ('completed','cancelled')
    for update;
  if target_run_id is null then raise exception 'external_execution_not_retryable'; end if;
  update external_authoring_claims set
    status = 'fenced', operation_deadline_at = null,
    last_activity_at = target_requeued_at, updated_at = target_requeued_at
    where execution_id = target_execution_id and status = 'active';
  update external_authoring_operations set
    status = 'cancelled', error_code = 'execution_requeued',
    completed_at = target_requeued_at, updated_at = target_requeued_at
    where execution_id = target_execution_id and status in ('reserved','running');
  update external_authoring_executions set
    status = 'queued', current_operation_id = null, completed_at = null,
    deadline_at = null, updated_at = target_requeued_at
    where id = target_execution_id;
  return jsonb_build_object('executionId', target_execution_id, 'runId', target_run_id, 'requeuedAt', target_requeued_at);
end;
$$;

create or replace function expire_external_authoring_execution_deadlines(target_expired_at timestamptz)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare execution_ids text[];
begin
  perform pg_advisory_xact_lock(hashtextextended('external-authoring-deadlines', 0));
  select array_agg(candidate.id) into execution_ids
  from (
    select id from external_authoring_executions
    where status in ('claimed','needs_input','authoring','finalizing')
      and deadline_at is not null
      and deadline_at <= target_expired_at
    for update
  ) candidate;
  execution_ids := coalesce(execution_ids, array[]::text[]);
  if cardinality(execution_ids) = 0 then return execution_ids; end if;
  update external_authoring_claims set
    status = 'fenced', operation_deadline_at = null,
    last_activity_at = target_expired_at, updated_at = target_expired_at
    where execution_id = any(execution_ids) and status = 'active';
  update external_authoring_operations set
    status = 'cancelled', error_code = 'execution_deadline_exceeded',
    completed_at = target_expired_at, updated_at = target_expired_at
    where execution_id = any(execution_ids) and status in ('reserved','running');
  update external_authoring_executions set
    status = 'failed', current_operation_id = null, completed_at = target_expired_at,
    last_activity_at = target_expired_at, updated_at = target_expired_at
    where id = any(execution_ids);
  update site_agent_runs set
    status = 'failed', completed_at = target_expired_at,
    run = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(run, '{status}', '"failed"', true),
                '{stage}', '"failed"', true
              ),
              '{failureCode}', '"execution_deadline_exceeded"', true
            ),
            '{failureCategory}', '"worker"', true
          ),
          '{retryableByOwner}', 'true'::jsonb, true
        ),
        '{failureReason}', to_jsonb('The external two-hour execution deadline elapsed. The last durable draft was preserved and can be retried.'::text), true
      ),
      '{completedAt}', to_jsonb(target_expired_at::text), true
    )
    where id in (
      select run_id from external_authoring_executions where id = any(execution_ids)
    );
  return execution_ids;
end;
$$;

create or replace function cancel_external_authoring_batch(target_batch_id text, target_cancelled_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare execution_ids text[];
begin
  update external_authoring_batches
    set cancel_requested_at = coalesce(cancel_requested_at, target_cancelled_at)
    where id = target_batch_id;
  select array_agg(e.id) into execution_ids
  from external_authoring_executions e
  join external_authoring_batch_items i on i.id = e.batch_item_id
  where i.batch_id = target_batch_id and e.status not in ('completed','failed','cancelled');
  update external_authoring_claims set
    status = 'fenced', operation_deadline_at = null, last_activity_at = target_cancelled_at, updated_at = target_cancelled_at
    where execution_id = any(coalesce(execution_ids, array[]::text[])) and status = 'active';
  update external_authoring_operations set
    status = 'cancelled', error_code = 'batch_cancelled', completed_at = target_cancelled_at, updated_at = target_cancelled_at
    where execution_id = any(coalesce(execution_ids, array[]::text[])) and status = 'reserved';
  update external_authoring_executions set
    status = 'cancelled',
    current_operation_id = case
      when exists (
        select 1 from external_authoring_operations o
        where o.id = external_authoring_executions.current_operation_id and o.status = 'running'
      ) then current_operation_id else null end,
    completed_at = target_cancelled_at, updated_at = target_cancelled_at
    where id = any(coalesce(execution_ids, array[]::text[]));
  update site_agent_runs set
    status = 'cancelled', completed_at = target_cancelled_at,
    run = jsonb_set(
      jsonb_set(run, '{status}', '"cancelled"', true),
      '{completedAt}', to_jsonb(target_cancelled_at::text), true
    )
    where id in (
      select e.run_id from external_authoring_executions e
      join external_authoring_batch_items i on i.id = e.batch_item_id
      where i.batch_id = target_batch_id
    ) and status in ('queued','running','needs_input');
  return jsonb_build_object('batchId', target_batch_id, 'cancelledAt', target_cancelled_at);
end;
$$;

create or replace function reserve_external_authoring_operation(
  operation_document jsonb,
  expected_state_revision integer,
  provided_capability_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_claim external_authoring_claims;
  target_execution external_authoring_executions;
  existing_operation external_authoring_operations;
  server_work boolean;
  total_active integer;
  external_active integer;
begin
  select * into existing_operation from external_authoring_operations
    where operation_key = operation_document->>'operationKey';
  if existing_operation.id is not null then return to_jsonb(existing_operation); end if;
  select * into existing_operation from external_authoring_operations
    where claim_id = operation_document->>'claimId'
      and lease_generation = (operation_document->>'leaseGeneration')::integer
      and idempotency_key_hash = operation_document->>'idempotencyKeyHash';
  if existing_operation.id is not null then raise exception 'external_idempotency_key_conflict'; end if;

  perform pg_advisory_xact_lock(hashtextextended('site-agent-global-capacity', 0));
  select * into target_claim from external_authoring_claims
    where id = operation_document->>'claimId'
      and status = 'active'
      and capability_hash = provided_capability_hash
      and lease_generation = (operation_document->>'leaseGeneration')::integer
      and lease_expires_at > now()
    for update;
  if target_claim.id is null then raise exception 'external_claim_fenced'; end if;
  select * into target_execution from external_authoring_executions
    where id = target_claim.execution_id for update;
  if target_execution.state_revision <> expected_state_revision then raise exception 'external_state_revision_conflict'; end if;
  if target_execution.deadline_at <= now() then raise exception 'external_execution_deadline_exceeded'; end if;

  server_work := operation_document->>'toolName' in ('build_preview','inspect_site','finish');
  if server_work then
    select count(*) into external_active from external_authoring_operations
      where status in ('reserved','running') and tool_name in ('build_preview','inspect_site','finish');
    select count(*) into total_active from site_agent_runs
      where status = 'running' and execution_driver = 'responses_api';
    total_active := total_active + external_active;
    if total_active >= 4 or external_active >= 3 then return null; end if;
  end if;

  insert into external_authoring_operations (
    id, execution_id, claim_id, schema_version, lease_generation, operation_key, idempotency_key_hash, tool_name,
    arguments_hash, pre_state_revision, pre_workspace_hash, status, deadline_at, created_at, updated_at
  ) values (
    operation_document->>'id', target_execution.id, target_claim.id, 1, target_claim.lease_generation,
    operation_document->>'operationKey', operation_document->>'idempotencyKeyHash',
    operation_document->>'toolName', operation_document->>'argumentsHash',
    expected_state_revision, target_execution.workspace_hash, 'reserved',
    (operation_document->>'deadlineAt')::timestamptz, now(), now()
  ) returning * into existing_operation;
  update external_authoring_executions set
    current_operation_id = existing_operation.id,
    status = case when operation_document->>'toolName' = 'finish' then 'finalizing' else 'authoring' end,
    last_activity_at = now(), updated_at = now()
    where id = target_execution.id;
  update external_authoring_claims set
    operation_deadline_at = existing_operation.deadline_at, last_activity_at = now(), updated_at = now()
    where id = target_claim.id;
  return to_jsonb(existing_operation);
end;
$$;

create or replace function complete_external_authoring_operation(
  target_operation_id text,
  provided_capability_hash text,
  target_result jsonb,
  target_workspace_hash text,
  target_checkpoint_key text,
  target_checkpoint_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_operation external_authoring_operations;
  target_execution external_authoring_executions;
begin
  select o.* into target_operation
  from external_authoring_operations o
  join external_authoring_claims c on c.id = o.claim_id
  where o.id = target_operation_id
    and c.status = 'active'
    and c.capability_hash = provided_capability_hash
    and c.lease_generation = o.lease_generation
  for update of o;
  if target_operation.id is null then raise exception 'external_claim_fenced'; end if;
  if target_operation.status = 'succeeded' then return to_jsonb(target_operation); end if;
  if target_operation.status not in ('reserved','running') then raise exception 'external_operation_terminal'; end if;
  if target_operation.deadline_at <= now() then raise exception 'external_operation_deadline_exceeded'; end if;
  select * into target_execution from external_authoring_executions
    where id = target_operation.execution_id and state_revision = target_operation.pre_state_revision
    for update;
  if target_execution.id is null then raise exception 'external_state_revision_conflict'; end if;

  update external_authoring_operations set
    status = 'succeeded',
    result = target_result,
    post_state_revision = pre_state_revision + 1,
    post_workspace_hash = target_workspace_hash,
    completed_at = now(),
    updated_at = now()
    where id = target_operation.id
    returning * into target_operation;
  update external_authoring_executions set
    state_revision = state_revision + 1,
    workspace_hash = target_workspace_hash,
    checkpoint_key = target_checkpoint_key,
    checkpoint_hash = target_checkpoint_hash,
    current_operation_id = null,
    last_activity_at = now(),
    updated_at = now()
    where id = target_execution.id;
  update external_authoring_claims set operation_deadline_at = null, last_activity_at = now(), updated_at = now()
    where id = target_operation.claim_id;
  return to_jsonb(target_operation);
end;
$$;

create or replace function fail_external_authoring_operation(
  target_operation_id text,
  provided_capability_hash text,
  target_error_code text,
  target_result jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare target_operation external_authoring_operations;
begin
  select o.* into target_operation
  from external_authoring_operations o
  join external_authoring_claims c on c.id = o.claim_id
  where o.id = target_operation_id
    and c.capability_hash = provided_capability_hash
  for update of o;
  if target_operation.id is null then return null; end if;
  if target_operation.status in ('reserved','running') then
    update external_authoring_operations set
      status = 'failed',
      error_code = target_error_code,
      result = target_result,
      completed_at = now(),
      updated_at = now()
      where id = target_operation.id
      returning * into target_operation;
    update external_authoring_executions set
      current_operation_id = null,
      updated_at = now()
      where id = target_operation.execution_id
        and current_operation_id = target_operation.id;
    update external_authoring_claims set
      operation_deadline_at = null,
      last_activity_at = now(),
      updated_at = now()
      where id = target_operation.claim_id;
  end if;
  return to_jsonb(target_operation);
end;
$$;

create or replace function claim_authoring_outbox(target_worker_id text)
returns setof authoring_outbox
language plpgsql
security definer
set search_path = public
as $$
declare target_id text;
begin
  select id into target_id from authoring_outbox
    where (status = 'pending' and run_after <= now())
      or (status = 'processing' and locked_at < now() - interval '15 minutes')
    order by created_at
    for update skip locked
    limit 1;
  if target_id is null then return; end if;
  return query update authoring_outbox
    set status = 'processing', attempts = attempts + 1, locked_by = target_worker_id,
      locked_at = now(), last_error = null
    where id = target_id returning *;
end;
$$;

create or replace function finalize_verified_authoring(
  target_finalization_key text,
  revision_document jsonb,
  artifact_document jsonb,
  version_document jsonb,
  run_document jsonb,
  session_document jsonb,
  outbox_document jsonb,
  preview_grant_document jsonb default null,
  external_document jsonb default null,
  media_adoption_document jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_site sites;
  target_execution external_authoring_executions;
  target_claim external_authoring_claims;
  retained_result jsonb;
  assigned_version_number integer;
  final_version jsonb;
  receipt_count integer;
  receipt_ids jsonb;
  media_item jsonb;
  current_business_revision integer;
begin
  if target_finalization_key !~ '^sha256:[a-f0-9]{64}$' then raise exception 'invalid_finalization_key'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_finalization_key, 0));

  if external_document is not null then
    select * into target_execution from external_authoring_executions
      where id = external_document->>'executionId' for update;
    if target_execution.id is null then raise exception 'external_execution_missing'; end if;
    if target_execution.finalization_key = target_finalization_key and target_execution.finalization_result is not null then
      return target_execution.finalization_result;
    end if;
    if target_execution.state_revision <> (external_document->>'expectedStateRevision')::integer then
      raise exception 'external_state_revision_conflict';
    end if;
    select * into target_claim from external_authoring_claims
      where id = external_document->>'claimId'
        and execution_id = target_execution.id
        and lease_generation = (external_document->>'leaseGeneration')::integer
        and capability_hash = external_document->>'capabilityHash'
        and status = 'active'
      for update;
    if target_claim.id is null then raise exception 'external_claim_fenced'; end if;
    if target_execution.deadline_at <= now() then raise exception 'external_execution_deadline_exceeded'; end if;
    if not exists (
      select 1 from external_authoring_operations
      where id = target_execution.current_operation_id
        and claim_id = target_claim.id
        and tool_name = 'finish'
        and status in ('reserved','running')
        and deadline_at > now()
    ) then raise exception 'external_operation_deadline_exceeded'; end if;
    receipt_ids := coalesce(external_document->'receiptIds', '[]'::jsonb);
    if jsonb_typeof(receipt_ids) <> 'array' then raise exception 'invalid_staged_blob_receipts'; end if;
    select count(*) into receipt_count from staged_blob_receipts
      where id in (select jsonb_array_elements_text(receipt_ids))
        and consumed_at is null
        and (staged_blob_receipts.finalization_key is null or staged_blob_receipts.finalization_key = target_finalization_key);
    if receipt_count <> jsonb_array_length(receipt_ids) then raise exception 'staged_blob_receipt_missing'; end if;
  end if;

  if artifact_document#>>'{qa,hardGate}' <> 'passed'
    or artifact_document->>'siteId' <> revision_document->>'siteId'
    or artifact_document->>'workspaceRevisionId' <> revision_document->>'id'
    or version_document->>'artifactId' <> artifact_document->>'id'
    or version_document->>'workspaceRevisionId' <> revision_document->>'id'
    or run_document->>'siteId' <> revision_document->>'siteId'
    or session_document->>'siteId' <> revision_document->>'siteId' then
    raise exception 'verified_authoring_mismatch';
  end if;

  select * into target_site from sites
    where id = revision_document->>'siteId'
      and current_workspace_revision_id is not distinct from nullif(revision_document->>'parentRevisionId', '')
    for update;
  if target_site.id is null then raise exception 'stale_parent_revision'; end if;

  if media_adoption_document is not null then
    select revision into current_business_revision from business_states
      where business_id = media_adoption_document#>>'{businessState,businessId}'
      for update;
    if current_business_revision is null
      or current_business_revision <> (media_adoption_document->>'expectedBusinessRevision')::integer
      or (media_adoption_document#>>'{businessState,revision}')::integer <> current_business_revision + 1
      or media_adoption_document#>>'{publicBuildInput,id}' <> artifact_document->>'publicBuildInputId'
      or media_adoption_document#>>'{publicBuildInput,id}' <> version_document->>'publicBuildInputId'
      or media_adoption_document#>>'{businessState,siteId}' <> target_site.id then
      raise exception 'stale_generated_media_adoption';
    end if;
    for media_item in select * from jsonb_array_elements(media_adoption_document->'assetRevisions') loop
      insert into asset_revisions (
        id, asset_id, business_id, schema_version, content_hash, storage_path, public_url,
        mime_type, bytes, width, height, origin, provenance, created_at
      ) values (
        media_item->>'id', media_item->>'assetId', media_item->>'businessId',
        (media_item->>'schemaVersion')::integer, media_item->>'contentHash',
        media_item->>'storageKey', media_item->>'publicUrl', media_item->>'mimeType',
        (media_item->>'bytes')::integer, (media_item->>'width')::integer,
        (media_item->>'height')::integer, media_item->>'origin',
        media_item->'provenance', (media_item->>'createdAt')::timestamptz
      );
    end loop;
    update business_states set
      schema_version = (media_adoption_document#>>'{businessState,schemaVersion}')::integer,
      revision = (media_adoption_document#>>'{businessState,revision}')::integer,
      state_hash = media_adoption_document#>>'{businessState,stateHash}',
      state = media_adoption_document->'businessState',
      updated_at = (media_adoption_document#>>'{businessState,updatedAt}')::timestamptz
      where business_id = media_adoption_document#>>'{businessState,businessId}';
    insert into site_public_build_inputs (
      id, site_id, business_id, schema_version, business_state_revision, site_intent_revision,
      domain_context_id, domain_context_version, input_hash, input, created_at
    ) values (
      media_adoption_document#>>'{publicBuildInput,id}',
      media_adoption_document#>>'{publicBuildInput,siteId}',
      media_adoption_document#>>'{publicBuildInput,businessId}',
      (media_adoption_document#>>'{publicBuildInput,schemaVersion}')::integer,
      (media_adoption_document#>>'{publicBuildInput,businessStateRevision}')::integer,
      (media_adoption_document#>>'{publicBuildInput,siteIntentRevision}')::integer,
      media_adoption_document#>>'{publicBuildInput,domainContext,id}',
      media_adoption_document#>>'{publicBuildInput,domainContext,version}',
      media_adoption_document#>>'{publicBuildInput,inputHash}',
      media_adoption_document->'publicBuildInput',
      (media_adoption_document#>>'{publicBuildInput,createdAt}')::timestamptz
    );
    insert into site_public_build_input_sources
      select media_adoption_document#>>'{publicBuildInput,id}', value
      from jsonb_array_elements_text(media_adoption_document#>'{publicBuildInput,sourceSnapshotIds}');
    insert into site_public_build_input_assets
      select media_adoption_document#>>'{publicBuildInput,id}', value
      from jsonb_array_elements_text(media_adoption_document#>'{publicBuildInput,assetRevisionIds}');
    insert into site_public_build_input_forms
      select media_adoption_document#>>'{publicBuildInput,id}', value->>'id'
      from jsonb_array_elements(media_adoption_document#>'{publicBuildInput,forms}');
    update site_versions set
      status = 'stale',
      stale_reason = 'stale_input',
      version = jsonb_set(jsonb_set(version, '{status}', '"stale"', true), '{staleReason}', '"stale_input"', true)
      where site_id = target_site.id and status = 'candidate';
    update sites set current_public_build_input_id = media_adoption_document#>>'{publicBuildInput,id}'
      where id = target_site.id;
  end if;

  insert into site_workspace_revisions (
    id, site_id, schema_version, parent_revision_id, revision_number, source_hash,
    source_archive_key, files, created_by_kind, created_by_id, created_at
  ) values (
    revision_document->>'id', revision_document->>'siteId', (revision_document->>'schemaVersion')::integer,
    nullif(revision_document->>'parentRevisionId', ''), (revision_document->>'revisionNumber')::integer,
    revision_document->>'sourceHash', revision_document->>'sourceArchiveKey', revision_document->'files',
    revision_document#>>'{createdBy,kind}', revision_document#>>'{createdBy,id}',
    (revision_document->>'createdAt')::timestamptz
  );
  insert into site_build_artifacts (
    id, site_id, workspace_revision_id, public_build_input_id, runtime_series_id,
    runtime_patch_at_finalization, schema_version, artifact_hash, storage_prefix, artifact,
    hard_gate_status, toolchain_version, sandbox_image_digest, created_at
  ) values (
    artifact_document->>'id', artifact_document->>'siteId', artifact_document->>'workspaceRevisionId',
    artifact_document->>'publicBuildInputId', artifact_document->>'runtimeSeriesId',
    artifact_document->>'runtimePatchAtFinalization', (artifact_document->>'schemaVersion')::integer,
    artifact_document->>'artifactHash', artifact_document->>'storagePrefix', artifact_document,
    artifact_document#>>'{qa,hardGate}', artifact_document->>'toolchainVersion',
    artifact_document->>'sandboxImageDigest', (artifact_document->>'createdAt')::timestamptz
  );

  select coalesce(max(version_number), 0) + 1 into assigned_version_number
    from site_versions where site_id = target_site.id;
  final_version := jsonb_set(version_document, '{number}', to_jsonb(assigned_version_number), true);
  insert into site_versions (
    id, site_id, schema_version, version_number, status, artifact_id, workspace_revision_id,
    public_build_input_id, version, created_by_kind, created_by_id, created_at,
    published_at, replaced_version_id, stale_reason
  ) values (
    final_version->>'id', final_version->>'siteId', (final_version->>'schemaVersion')::integer,
    assigned_version_number, final_version->>'status', final_version->>'artifactId',
    final_version->>'workspaceRevisionId', final_version->>'publicBuildInputId', final_version,
    final_version#>>'{createdBy,kind}', final_version#>>'{createdBy,id}',
    (final_version->>'createdAt')::timestamptz, nullif(final_version->>'publishedAt', '')::timestamptz,
    nullif(final_version->>'replacedVersionId', ''), final_version->>'staleReason'
  );
  insert into site_version_sources
    select final_version->>'id', value from jsonb_array_elements_text(final_version->'sourceSnapshotIds');
  insert into site_version_assets
    select final_version->>'id', value from jsonb_array_elements_text(final_version->'assetRevisionIds');
  insert into site_version_forms
    select final_version->>'id', value from jsonb_array_elements_text(final_version->'formDefinitionIds');

  update sites set current_workspace_revision_id = revision_document->>'id',
    updated_at = (revision_document->>'createdAt')::timestamptz
    where id = target_site.id;
  update site_agent_sessions set
    status = session_document->>'status',
    current_workspace_revision_id = nullif(session_document->>'currentWorkspaceRevisionId', ''),
    public_build_input_id = session_document->>'publicBuildInputId',
    sandbox_provider = session_document->>'sandboxProvider',
    sandbox_id = nullif(session_document->>'sandboxId', ''),
    sandbox_last_started_at = nullif(session_document->>'sandboxLastStartedAt', '')::timestamptz,
    sandbox_last_destroyed_at = nullif(session_document->>'sandboxLastDestroyedAt', '')::timestamptz,
    sandbox_provisioned_ms = coalesce((session_document->>'sandboxProvisionedMs')::bigint, 0),
    sandbox_destroy_attempts = coalesce((session_document->>'sandboxDestroyAttempts')::integer, 0),
    lease_token_hash = session_document->>'leaseTokenHash',
    lease_expires_at = (session_document->>'leaseExpiresAt')::timestamptz,
    rotate_at = (session_document->>'rotateAt')::timestamptz,
    updated_at = (session_document->>'updatedAt')::timestamptz
    where id = session_document->>'id';
  update site_agent_runs set
    status = run_document->>'status',
    output_revision_id = nullif(run_document->>'outputRevisionId', ''),
    execution_driver = run_document->>'executionDriver',
    api_provider = nullif(run_document->>'apiProvider', ''),
    model_id = nullif(run_document->>'modelId', ''),
    run = run_document,
    completed_at = nullif(run_document->>'completedAt', '')::timestamptz
    where id = run_document->>'id';

  if preview_grant_document is not null then
    insert into preview_grants (
      id, site_id, site_version_id, secret_hash, key_version, secret_version,
      expires_at, revoked_at, created_at
    ) values (
      preview_grant_document->>'id', preview_grant_document->>'siteId',
      preview_grant_document->>'siteVersionId', preview_grant_document->>'secretHash',
      preview_grant_document->>'keyVersion', (preview_grant_document->>'secretVersion')::integer,
      (preview_grant_document->>'expiresAt')::timestamptz,
      nullif(preview_grant_document->>'revokedAt', '')::timestamptz,
      (preview_grant_document->>'createdAt')::timestamptz
    );
  end if;

  insert into authoring_outbox (
    id, schema_version, event_type, aggregate_id, payload, status, attempts, run_after,
    locked_by, locked_at, last_error, created_at, completed_at
  ) values (
    outbox_document->>'id', (outbox_document->>'schemaVersion')::integer,
    outbox_document->>'eventType', outbox_document->>'aggregateId', outbox_document->'payload',
    outbox_document->>'status', (outbox_document->>'attempts')::integer,
    (outbox_document->>'runAfter')::timestamptz, nullif(outbox_document->>'lockedBy', ''),
    nullif(outbox_document->>'lockedAt', '')::timestamptz, outbox_document->>'lastError',
    (outbox_document->>'createdAt')::timestamptz, nullif(outbox_document->>'completedAt', '')::timestamptz
  ) on conflict (event_type, aggregate_id) do nothing;

  retained_result := jsonb_build_object(
    'version', final_version,
    'run', run_document,
    'previewId', preview_grant_document->>'id',
    'keyVersion', preview_grant_document->>'keyVersion',
    'secretVersion', (preview_grant_document->>'secretVersion')::integer
  );
  if external_document is not null then
    update external_authoring_batch_items set
      candidate_version_id = final_version->>'id',
      preview_id = preview_grant_document->>'id',
      updated_at = now()
      where id = external_document->>'batchItemId';
    update outbound_prospects set preview_id = preview_grant_document->>'id'
      where id = (
        select prospect_id from external_authoring_batch_items
        where id = external_document->>'batchItemId'
      );
    update external_authoring_operations set
      status = 'succeeded',
      result = jsonb_build_object(
        'ok', true,
        'completed', true,
        'candidateVersionId', final_version->>'id',
        'previewId', preview_grant_document->>'id'
      ),
      post_state_revision = pre_state_revision + 1,
      post_workspace_hash = revision_document->>'sourceHash',
      completed_at = now(),
      updated_at = now()
      where id = target_execution.current_operation_id
        and tool_name = 'finish'
        and status in ('reserved','running');
    update external_authoring_executions set
      status = 'completed', state_revision = state_revision + 1,
      current_operation_id = null, finalization_key = target_finalization_key,
      finalization_result = retained_result, completed_at = now(), last_activity_at = now(), updated_at = now()
      where id = target_execution.id;
    update external_authoring_claims set
      status = 'released', operation_deadline_at = null, last_activity_at = now(), updated_at = now()
      where id = target_claim.id;
    update staged_blob_receipts set
      finalization_key = target_finalization_key, consumed_at = now()
      where id in (select jsonb_array_elements_text(receipt_ids));
  end if;
  return retained_result;
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
  if exists (
    select 1 from site_agent_maintenance_leases
    where task = 'workspace-cutover' and lease_until > now()
  ) then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('site-agent-global-capacity', 0));
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

create or replace function promote_site_version(target_version_id text, actor_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare target_site_id text; target_artifact_id text; previous_id text;
begin
  select site_id, artifact_id into target_site_id, target_artifact_id
    from site_versions where id = target_version_id and status in ('candidate', 'superseded') for update;
  if target_site_id is null then raise exception 'version_not_promotable'; end if;
  perform 1 from sites where id = target_site_id and owner_user_id is not null for update;
  if not found then raise exception 'site_not_owned'; end if;
  if not exists (select 1 from site_build_artifacts where id = target_artifact_id and hard_gate_status = 'passed') then
    raise exception 'artifact_hard_gate_failed';
  end if;
  if exists (
    select 1
    from site_build_artifacts
    where id = target_artifact_id
      and artifact#>'{qa,findings}' @> '[{"id":"asset.reference_only"}]'::jsonb
  ) then
    raise exception 'preview_only_reference_assets';
  end if;
  select id into previous_id from site_versions where site_id = target_site_id and status = 'published' for update;
  update site_versions set status = 'superseded', version = jsonb_set(version, '{status}', '"superseded"', true)
    where id = previous_id;
  update site_versions set
    status = 'published', published_at = now(), replaced_version_id = previous_id,
    version = jsonb_set(jsonb_set(version, '{status}', '"published"', true), '{publishedAt}', to_jsonb(now()::text), true)
    where id = target_version_id;
  update form_definitions set status = 'published'
    where id in (select form_definition_id from site_version_forms where version_id = target_version_id);
  update sites set status = 'active', published_version_id = target_version_id, updated_at = now()
    where id = target_site_id;
  return jsonb_build_object('siteId', target_site_id, 'versionId', target_version_id, 'actorId', actor_id);
end;
$$;

alter table preview_grants enable row level security;
alter table external_authoring_batches enable row level security;
alter table external_authoring_batch_items enable row level security;
alter table authoring_execution_bundles enable row level security;
alter table external_authoring_executions enable row level security;
alter table external_authoring_claims enable row level security;
alter table external_authoring_operations enable row level security;
alter table external_authoring_credentials enable row level security;
alter table external_authoring_credential_requests enable row level security;
alter table staged_blob_receipts enable row level security;
alter table authoring_outbox enable row level security;

revoke all on table preview_grants, external_authoring_batches, external_authoring_batch_items,
  authoring_execution_bundles, external_authoring_executions, external_authoring_claims,
  external_authoring_operations, external_authoring_credentials, external_authoring_credential_requests,
  staged_blob_receipts, authoring_outbox from public, anon, authenticated;
grant select, insert, update, delete on table preview_grants, external_authoring_batches,
  external_authoring_batch_items, authoring_execution_bundles, external_authoring_executions,
  external_authoring_claims, external_authoring_operations, external_authoring_credentials,
  external_authoring_credential_requests, staged_blob_receipts, authoring_outbox to service_role;
grant usage, select on sequence external_authoring_credential_requests_id_seq to service_role;

revoke all on function claim_next_external_authoring(text,text,text,text,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function claim_external_batch_preparation(text) from public, anon, authenticated;
revoke all on function cancel_external_authoring_batch(text,timestamptz) from public, anon, authenticated;
revoke all on function requeue_external_authoring_execution(text,timestamptz) from public, anon, authenticated;
revoke all on function expire_external_authoring_execution_deadlines(timestamptz) from public, anon, authenticated;
revoke all on function reserve_external_authoring_operation(jsonb,integer,text) from public, anon, authenticated;
revoke all on function complete_external_authoring_operation(text,text,jsonb,text,text,text) from public, anon, authenticated;
revoke all on function fail_external_authoring_operation(text,text,text,jsonb) from public, anon, authenticated;
revoke all on function claim_authoring_outbox(text) from public, anon, authenticated;
revoke all on function finalize_verified_authoring(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function claim_next_external_authoring(text,text,text,text,timestamptz,timestamptz) to service_role;
grant execute on function claim_external_batch_preparation(text) to service_role;
grant execute on function cancel_external_authoring_batch(text,timestamptz) to service_role;
grant execute on function requeue_external_authoring_execution(text,timestamptz) to service_role;
grant execute on function expire_external_authoring_execution_deadlines(timestamptz) to service_role;
grant execute on function reserve_external_authoring_operation(jsonb,integer,text) to service_role;
grant execute on function complete_external_authoring_operation(text,text,jsonb,text,text,text) to service_role;
grant execute on function fail_external_authoring_operation(text,text,text,jsonb) to service_role;
grant execute on function claim_authoring_outbox(text) to service_role;
grant execute on function finalize_verified_authoring(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
