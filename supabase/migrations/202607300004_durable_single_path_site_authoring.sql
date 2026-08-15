-- Durable single-path authoring: atomic bootstrap/enqueue, one fenced worker
-- queue, exact candidate promotion, and append-only model continuation.

begin;

do $$
begin
  if exists (select 1 from public.website_setups limit 1)
    or exists (select 1 from public.authoring_outbox limit 1) then
    raise exception 'prelaunch_site_authoring_reset_required';
  end if;
end;
$$;

do $$
declare
  definition text;
  insertion_start integer;
  insertion_end integer;
  insertion_end_marker constant text :=
    '  ) on conflict (event_type, aggregate_id) do nothing;';
begin
  select pg_get_functiondef(
    'public.finalize_verified_authoring(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ) into definition;
  insertion_start := strpos(definition, '  insert into authoring_outbox (');
  insertion_end := strpos(definition, insertion_end_marker);
  if insertion_start = 0 or insertion_end = 0 or insertion_end < insertion_start then
    raise exception 'finalize_verified_authoring_outbox_block_not_found';
  end if;
  definition :=
    substring(definition from 1 for insertion_start - 1)
    || substring(
      definition
      from insertion_end + length(insertion_end_marker)
    );
  definition := regexp_replace(
    definition,
    'outbox_document jsonb,[[:space:]]*',
    ''
  );
  execute definition;
end;
$$;

drop function public.finalize_verified_authoring(
  text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
);
drop function if exists public.claim_authoring_outbox(text);
drop table public.authoring_outbox;
drop table public.website_setups cascade;

revoke all on function public.finalize_verified_authoring(
  text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
) from public, anon, authenticated;
grant execute on function public.finalize_verified_authoring(
  text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
) to service_role;

create or replace function public.private_user_active_operation_count(
  target_owner_user_id uuid
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.site_agent_runs run_row
  join public.sites site_row on site_row.id = run_row.site_id
  where site_row.owner_user_id = target_owner_user_id
    and run_row.status in ('queued', 'running');
$$;

create or replace function public.dispose_owned_site(
  target_site_id text,
  target_owner_user_id uuid
)
returns setof public.sites
language plpgsql
security definer
set search_path = public
as $$
declare
  disposed_at timestamptz := now();
begin
  perform pg_advisory_xact_lock(
    hashtextextended(target_owner_user_id::text, 0)
  );
  perform 1
    from public.sites
    where id = target_site_id
      and owner_user_id = target_owner_user_id
    for update;
  if not found then return; end if;

  update public.site_agent_run_events
    set status = 'cancelled', completed_at = disposed_at
    where status = 'running'
      and run_id in (
        select id
        from public.site_agent_runs
        where site_id = target_site_id
          and status in ('queued', 'running', 'needs_input')
      );
  update public.site_agent_runs
    set
      status = 'cancelled',
      completed_at = disposed_at,
      run = jsonb_set(
        jsonb_set(run, '{status}', '"cancelled"', true),
        '{completedAt}',
        to_jsonb(
          to_char(
            disposed_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
        ),
        true
      )
    where site_id = target_site_id
      and status in ('queued', 'running', 'needs_input');
  update public.site_agent_sessions
    set
      lease_expires_at = disposed_at,
      rotate_at = disposed_at,
      updated_at = disposed_at
    where site_id = target_site_id
      and status in ('active', 'checkpointed', 'rotating');
  update public.preview_grants
    set revoked_at = coalesce(revoked_at, disposed_at)
    where site_id = target_site_id;
  delete from public.active_domains where site_id = target_site_id;
  update public.domains
    set
      status = 'expired',
      routing_status = 'pending',
      updated_at = disposed_at
    where site_id = target_site_id
      and status <> 'expired';

  return query
    update public.sites
      set
        status = 'paused',
        owner_user_id = null,
        updated_at = disposed_at
      where id = target_site_id
        and owner_user_id = target_owner_user_id
      returning *;
end;
$$;

revoke all on function public.private_user_active_operation_count(uuid)
  from public, anon, authenticated;
grant execute on function public.private_user_active_operation_count(uuid)
  to service_role;
revoke all on function public.dispose_owned_site(text,uuid)
  from public, anon, authenticated;
grant execute on function public.dispose_owned_site(text,uuid)
  to service_role;

create unique index site_versions_one_candidate_idx
  on public.site_versions(site_id)
  where status = 'candidate';
create unique index site_agent_runs_one_running_per_site_idx
  on public.site_agent_runs(site_id)
  where status = 'running';
create index site_agent_runs_claim_queue_idx
  on public.site_agent_runs(execution_driver, started_at, id)
  where status = 'queued';

alter table public.external_authoring_operations
  drop constraint external_authoring_operations_tool_name_check;
alter table public.external_authoring_operations
  add constraint external_authoring_operations_tool_name_check
  check (tool_name in (
    'list_files', 'search_files', 'read_files',
    'search_sources', 'read_source', 'retry_source', 'inspect_assets',
    'retrieve_public_source',
    'write_file', 'delete_file', 'apply_patch', 'edit_file',
    'configure_lead_form', 'create_image', 'build_preview', 'inspect_site',
    'request_input', 'finish'
  ));

create table public.site_authoring_bootstrap_requests (
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key_hash text not null
    check (idempotency_key_hash ~ '^sha256:[a-f0-9]{64}$'),
  request_hash text not null
    check (request_hash ~ '^sha256:[a-f0-9]{64}$'),
  site_id text not null unique references public.sites(id) on delete restrict,
  session_id text not null unique references public.site_agent_sessions(id) on delete restrict,
  run_id text not null unique references public.site_agent_runs(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (owner_user_id, idempotency_key_hash)
);

create table public.site_agent_continuation_heads (
  run_id text primary key references public.site_agent_runs(id) on delete cascade,
  generation integer not null check (generation > 0),
  execution_number integer not null check (execution_number > 0),
  api_provider text not null check (api_provider in ('openai', 'openrouter')),
  model_id text not null,
  stable_prefix_hash text not null
    check (stable_prefix_hash ~ '^sha256:[a-f0-9]{64}$'),
  latest_sequence integer not null check (latest_sequence >= 0),
  response_count integer not null check (response_count >= 0),
  status text not null check (status in ('active', 'awaiting_input', 'terminal', 'stale')),
  purge_after timestamptz,
  head jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create index site_agent_continuation_heads_purge_idx
  on public.site_agent_continuation_heads(purge_after)
  where purge_after is not null;

create table public.site_agent_continuation_segments (
  id text primary key,
  run_id text not null references public.site_agent_runs(id) on delete cascade,
  generation integer not null check (generation > 0),
  sequence integer not null check (sequence > 0),
  execution_number integer not null check (execution_number > 0),
  api_provider text not null check (api_provider in ('openai', 'openrouter')),
  model_id text not null,
  content_hash text not null check (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  blob_ref text not null,
  byte_count bigint not null check (byte_count >= 0),
  response_count integer not null check (response_count >= 0),
  segment jsonb not null,
  created_at timestamptz not null,
  unique (run_id, generation, sequence),
  unique (blob_ref, content_hash)
);
create index site_agent_continuation_segments_run_idx
  on public.site_agent_continuation_segments(run_id, generation, sequence);

alter table public.site_authoring_bootstrap_requests enable row level security;
alter table public.site_agent_continuation_heads enable row level security;
alter table public.site_agent_continuation_segments enable row level security;

revoke all on table public.site_authoring_bootstrap_requests
  from public, anon, authenticated;
revoke all on table public.site_agent_continuation_heads
  from public, anon, authenticated;
revoke all on table public.site_agent_continuation_segments
  from public, anon, authenticated;
grant all on table public.site_authoring_bootstrap_requests to service_role;
grant all on table public.site_agent_continuation_heads to service_role;
grant all on table public.site_agent_continuation_segments to service_role;

create or replace function public.bootstrap_site_authoring(
  target_owner_user_id uuid,
  target_idempotency_key text,
  target_request_hash text,
  site_document jsonb,
  state_document jsonb,
  intent_document jsonb,
  form_documents jsonb,
  source_documents jsonb,
  asset_documents jsonb,
  public_input_document jsonb,
  session_document jsonb,
  run_document jsonb,
  message_document jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_idempotency_hash text;
  retained site_authoring_bootstrap_requests;
begin
  if target_idempotency_key is null
    or length(target_idempotency_key) < 8
    or length(target_idempotency_key) > 160 then
    raise exception 'invalid_idempotency_key';
  end if;
  if target_request_hash !~ '^sha256:[a-f0-9]{64}$' then
    raise exception 'invalid_request_hash';
  end if;
  target_idempotency_hash :=
    'sha256:' || encode(extensions.digest(target_idempotency_key, 'sha256'), 'hex');

  perform pg_advisory_xact_lock(
    hashtextextended(target_owner_user_id::text || ':' || target_idempotency_hash, 0)
  );
  select * into retained
    from site_authoring_bootstrap_requests
    where owner_user_id = target_owner_user_id
      and idempotency_key_hash = target_idempotency_hash
    for update;
  if retained.site_id is not null then
    if retained.request_hash <> target_request_hash then
      raise exception 'idempotency_key_conflict';
    end if;
    return jsonb_build_object(
      'siteId', retained.site_id,
      'sessionId', retained.session_id,
      'runId', retained.run_id,
      'existing', true
    );
  end if;

  if site_document->>'ownerUserId' <> target_owner_user_id::text
    or state_document->>'siteId' <> site_document->>'id'
    or intent_document->>'siteId' <> site_document->>'id'
    or public_input_document->>'siteId' <> site_document->>'id'
    or session_document->>'siteId' <> site_document->>'id'
    or session_document#>>'{principal,kind}' <> 'owner'
    or session_document#>>'{principal,id}' <> target_owner_user_id::text
    or run_document->>'siteId' <> site_document->>'id'
    or run_document->>'sessionId' <> session_document->>'id'
    or run_document#>>'{request,kind}' <> 'initial_build'
    or run_document->>'status' <> 'queued'
    or message_document->>'sessionId' <> session_document->>'id'
    or message_document->>'runId' <> run_document->>'id'
    or message_document->>'role' <> 'owner' then
    raise exception 'authoring_bootstrap_scope_mismatch';
  end if;

  perform public.bootstrap_site(
    site_document,
    state_document,
    intent_document,
    form_documents,
    source_documents,
    asset_documents,
    public_input_document
  );

  insert into site_agent_sessions (
    id, site_id, principal_kind, principal_id, schema_version, status,
    current_workspace_revision_id, public_build_input_id, sandbox_provider,
    sandbox_id, sandbox_last_started_at, sandbox_last_destroyed_at,
    sandbox_provisioned_ms, sandbox_destroy_attempts, lease_token_hash,
    lease_expires_at, rotate_at, created_at, updated_at
  ) values (
    session_document->>'id',
    session_document->>'siteId',
    session_document#>>'{principal,kind}',
    session_document#>>'{principal,id}',
    session_document->>'schemaVersion',
    session_document->>'status',
    nullif(session_document->>'currentWorkspaceRevisionId', ''),
    session_document->>'publicBuildInputId',
    session_document->>'sandboxProvider',
    nullif(session_document->>'sandboxId', ''),
    nullif(session_document->>'sandboxLastStartedAt', '')::timestamptz,
    nullif(session_document->>'sandboxLastDestroyedAt', '')::timestamptz,
    coalesce((session_document->>'sandboxProvisionedMs')::bigint, 0),
    coalesce((session_document->>'sandboxDestroyAttempts')::integer, 0),
    session_document->>'leaseTokenHash',
    (session_document->>'leaseExpiresAt')::timestamptz,
    (session_document->>'rotateAt')::timestamptz,
    (session_document->>'createdAt')::timestamptz,
    (session_document->>'updatedAt')::timestamptz
  );

  perform public.enqueue_site_agent_run(run_document);

  insert into site_agent_messages (
    id, schema_version, session_id, run_id, role, content, selection, created_at
  ) values (
    message_document->>'id',
    message_document->>'schemaVersion',
    message_document->>'sessionId',
    message_document->>'runId',
    message_document->>'role',
    message_document->>'content',
    message_document->'selection',
    (message_document->>'createdAt')::timestamptz
  );

  insert into site_authoring_bootstrap_requests (
    owner_user_id, idempotency_key_hash, request_hash,
    site_id, session_id, run_id, created_at
  ) values (
    target_owner_user_id,
    target_idempotency_hash,
    target_request_hash,
    site_document->>'id',
    session_document->>'id',
    run_document->>'id',
    now()
  );

  return jsonb_build_object(
    'siteId', site_document->>'id',
    'sessionId', session_document->>'id',
    'runId', run_document->>'id',
    'existing', false
  );
end;
$$;

create or replace function public.enqueue_site_agent_request(
  run_document jsonb,
  message_document jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if message_document->>'runId' <> run_document->>'id'
    or message_document->>'sessionId' <> run_document->>'sessionId'
    or message_document->>'schemaVersion' <> 'site-agent-message'
    or not exists (
      select 1
      from site_agent_sessions session_row
      join sites site_row on site_row.id = session_row.site_id
      where session_row.id = run_document->>'sessionId'
        and session_row.site_id = run_document->>'siteId'
        and (
          message_document->>'role' <> 'owner'
          or (
            session_row.principal_kind = 'owner'
            and session_row.principal_id = site_row.owner_user_id::text
            and run_document->>'requestedBy' = site_row.owner_user_id::text
          )
        )
    ) then
    raise exception 'site_agent_request_scope_mismatch';
  end if;

  perform public.enqueue_site_agent_run(run_document);
  insert into site_agent_messages (
    id, schema_version, session_id, run_id, role, content, selection, created_at
  ) values (
    message_document->>'id',
    message_document->>'schemaVersion',
    message_document->>'sessionId',
    message_document->>'runId',
    message_document->>'role',
    message_document->>'content',
    message_document->'selection',
    (message_document->>'createdAt')::timestamptz
  );
  return run_document;
end;
$$;

create or replace function public.claim_next_site_agent_run(
  target_worker_id text,
  target_claimed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_run site_agent_runs;
  queued_run site_agent_runs;
  target_run site_agent_runs;
  target_site sites;
  active_count integer;
  next_execution integer;
  merged_change_ids jsonb := '[]'::jsonb;
  change_id text;
  run_value jsonb;
begin
  if target_worker_id is null
    or length(target_worker_id) < 1
    or length(target_worker_id) > 200 then
    raise exception 'invalid_worker_id';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('site-authoring-maintenance-claim-fence', 0)
  );
  if exists (
    select 1 from site_agent_maintenance_leases
    where task = 'site_authoring_maintenance'
      and lease_until > target_claimed_at
  ) then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('site-agent-global-capacity', 0));
  select count(*) into active_count
    from site_agent_runs
    where status = 'running'
      and execution_driver = 'responses_api';
  if active_count >= 4 then return null; end if;

  select candidate.* into selected_run
    from site_agent_runs candidate
    where candidate.status = 'queued'
      and candidate.execution_driver = 'responses_api'
      and not exists (
        select 1
        from site_agent_runs active
        where active.site_id = candidate.site_id
          and active.status = 'running'
      )
      and (
        nullif(candidate.run->>'deferredUntilRunId', '') is null
        or not exists (
          select 1
          from site_agent_runs predecessor
          where predecessor.id = candidate.run->>'deferredUntilRunId'
            and predecessor.status in ('queued', 'running')
        )
      )
    order by candidate.started_at, candidate.id
    for update skip locked
    limit 1;
  if selected_run.id is null then return null; end if;

  target_run := selected_run;
  if selected_run.run#>>'{request,kind}' = 'authority_refresh' then
    for queued_run in
      select candidate.*
      from site_agent_runs candidate
      where candidate.site_id = selected_run.site_id
        and candidate.status = 'queued'
        and candidate.execution_driver = 'responses_api'
        and (
          candidate.started_at > selected_run.started_at
          or (
            candidate.started_at = selected_run.started_at
            and candidate.id >= selected_run.id
          )
        )
      order by candidate.started_at, candidate.id
      for update
    loop
      exit when queued_run.run#>>'{request,kind}' <> 'authority_refresh';
      target_run := queued_run;
      for change_id in
        select jsonb_array_elements_text(
          coalesce(queued_run.run#>'{request,changeRequestIds}', '[]'::jsonb)
        )
      loop
        if not (merged_change_ids ? change_id) then
          merged_change_ids := merged_change_ids || to_jsonb(change_id);
        end if;
      end loop;
    end loop;

    update site_agent_runs coalesced set
      status = 'cancelled',
      completed_at = target_claimed_at,
      run = jsonb_set(
        jsonb_set(
          jsonb_set(
            coalesced.run,
            '{status}',
            '"cancelled"',
            true
          ),
          '{coalescedIntoRunId}',
          to_jsonb(target_run.id),
          true
        ),
        '{completedAt}',
        to_jsonb(
          to_char(
            target_claimed_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
        ),
        true
      )
      where coalesced.site_id = selected_run.site_id
        and coalesced.status = 'queued'
        and coalesced.execution_driver = 'responses_api'
        and coalesced.id <> target_run.id
        and coalesced.run#>>'{request,kind}' = 'authority_refresh'
        and (
          coalesced.started_at < target_run.started_at
          or (
            coalesced.started_at = target_run.started_at
            and coalesced.id < target_run.id
          )
        )
        and not exists (
          select 1
          from site_agent_runs barrier
          where barrier.site_id = selected_run.site_id
            and barrier.status = 'queued'
            and barrier.execution_driver = 'responses_api'
            and barrier.run#>>'{request,kind}' <> 'authority_refresh'
            and (
              barrier.started_at > selected_run.started_at
              or (
                barrier.started_at = selected_run.started_at
                and barrier.id > selected_run.id
              )
            )
            and (
              barrier.started_at < coalesced.started_at
              or (
                barrier.started_at = coalesced.started_at
                and barrier.id < coalesced.id
              )
            )
        );

    target_run.run := jsonb_set(
      target_run.run,
      '{request}',
      jsonb_build_object(
        'kind', 'authority_refresh',
        'changeRequestIds', merged_change_ids
      ),
      true
    ) - 'deferredUntilRunId';
  end if;

  select * into target_site
    from sites
    where id = target_run.site_id
      and owner_user_id is not null
      and status <> 'paused'
    for update;
  if target_site.id is null then return null; end if;

  next_execution :=
    coalesce((target_run.run->>'executionNumber')::integer, 0) + 1;
  run_value :=
    target_run.run
    - 'completedAt'
    - 'failureCode'
    - 'failureCategory'
    - 'failureReason'
    - 'retryableByOwner'
    - 'coalescedIntoRunId';
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
    '{publicBuildInputId}',
    to_jsonb(target_site.current_public_build_input_id),
    true
  );
  if target_site.current_workspace_revision_id is null then
    run_value := run_value - 'exactParentRevisionId';
  else
    run_value := jsonb_set(
      run_value,
      '{exactParentRevisionId}',
      to_jsonb(target_site.current_workspace_revision_id),
      true
    );
  end if;
  run_value := run_value - 'deferredUntilRunId';
  run_value := jsonb_set(
    run_value,
    '{executionNumber}',
    to_jsonb(next_execution),
    true
  );
  run_value := jsonb_set(
    run_value,
    '{workerId}',
    to_jsonb(target_worker_id),
    true
  );
  run_value := jsonb_set(
    run_value,
    '{heartbeatAt}',
    to_jsonb(
      to_char(
        target_claimed_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    ),
    true
  );

  update site_agent_sessions set
    public_build_input_id = target_site.current_public_build_input_id,
    updated_at = target_claimed_at
    where id = target_run.session_id;

  update site_agent_runs set
    status = 'running',
    exact_parent_revision_id = target_site.current_workspace_revision_id,
    run = run_value,
    completed_at = null
    where id = target_run.id
      and status = 'queued'
    returning * into target_run;
  if target_run.id is null then return null; end if;
  return target_run.run;
end;
$$;

create or replace function public.append_site_agent_continuation(
  head_document jsonb,
  segment_document jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_run site_agent_runs;
  retained site_agent_continuation_heads;
  target_execution integer;
  target_generation integer;
  target_sequence integer;
begin
  target_execution := (head_document->>'executionNumber')::integer;
  target_generation := (head_document->>'generation')::integer;
  target_sequence := (segment_document->>'sequence')::integer;

  select * into target_run
    from site_agent_runs
    where id = head_document->>'runId'
    for update;
  if target_run.id is null
    or target_run.status <> 'running'
    or coalesce((target_run.run->>'executionNumber')::integer, 0) <> target_execution
    or segment_document->>'runId' <> target_run.id
    or (segment_document->>'executionNumber')::integer <> target_execution
    or (segment_document->>'generation')::integer <> target_generation
    or target_sequence <> (head_document->>'latestSequence')::integer
    or (segment_document->>'responseCount')::integer <>
      (head_document->>'responseCount')::integer then
    raise exception 'continuation_execution_fenced';
  end if;

  select * into retained
    from site_agent_continuation_heads
    where run_id = target_run.id
    for update;
  if retained.run_id is null then
    if target_generation <> 1 or target_sequence <> 1 then
      raise exception 'continuation_sequence_conflict';
    end if;
  elsif retained.generation <> target_generation
    or retained.latest_sequence + 1 <> target_sequence
    or retained.api_provider <> head_document->>'apiProvider'
    or retained.model_id <> head_document->>'modelId'
    or retained.stable_prefix_hash <> head_document->>'stablePrefixHash'
    or retained.head->>'inputHash' <> head_document->>'inputHash' then
    raise exception 'continuation_sequence_conflict';
  end if;

  insert into site_agent_continuation_segments (
    id, run_id, generation, sequence, execution_number, api_provider, model_id,
    content_hash, blob_ref, byte_count, response_count, segment, created_at
  ) values (
    segment_document->>'id',
    segment_document->>'runId',
    (segment_document->>'generation')::integer,
    target_sequence,
    (segment_document->>'executionNumber')::integer,
    segment_document->>'apiProvider',
    segment_document->>'modelId',
    segment_document->>'contentHash',
    segment_document->>'blobRef',
    (segment_document->>'byteCount')::bigint,
    (segment_document->>'responseCount')::integer,
    segment_document,
    (segment_document->>'createdAt')::timestamptz
  );

  insert into site_agent_continuation_heads (
    run_id, generation, execution_number, api_provider, model_id,
    stable_prefix_hash, latest_sequence, response_count, status,
    purge_after, head, created_at, updated_at
  ) values (
    head_document->>'runId',
    target_generation,
    target_execution,
    head_document->>'apiProvider',
    head_document->>'modelId',
    head_document->>'stablePrefixHash',
    (head_document->>'latestSequence')::integer,
    (head_document->>'responseCount')::integer,
    head_document->>'status',
    nullif(head_document->>'purgeAfter', '')::timestamptz,
    head_document,
    (head_document->>'createdAt')::timestamptz,
    (head_document->>'updatedAt')::timestamptz
  )
  on conflict (run_id) do update set
    generation = excluded.generation,
    execution_number = excluded.execution_number,
    api_provider = excluded.api_provider,
    model_id = excluded.model_id,
    stable_prefix_hash = excluded.stable_prefix_hash,
    latest_sequence = excluded.latest_sequence,
    response_count = excluded.response_count,
    status = excluded.status,
    purge_after = excluded.purge_after,
    head = excluded.head,
    updated_at = excluded.updated_at;
  return head_document;
end;
$$;

create or replace function public.reset_site_agent_continuation(
  head_document jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_run site_agent_runs;
  retained site_agent_continuation_heads;
  target_execution integer;
  target_generation integer;
begin
  target_execution := (head_document->>'executionNumber')::integer;
  target_generation := (head_document->>'generation')::integer;
  select * into target_run
    from site_agent_runs
    where id = head_document->>'runId'
    for update;
  if target_run.id is null
    or target_run.status <> 'running'
    or coalesce((target_run.run->>'executionNumber')::integer, 0) <> target_execution
    or (head_document->>'latestSequence')::integer <> 0
    or (head_document->>'responseCount')::integer <> 0 then
    raise exception 'continuation_execution_fenced';
  end if;
  select * into retained
    from site_agent_continuation_heads
    where run_id = target_run.id
    for update;
  if retained.run_id is null then
    if target_generation <> 1 then
      raise exception 'continuation_generation_conflict';
    end if;
  elsif target_generation <> retained.generation + 1 then
    raise exception 'continuation_generation_conflict';
  end if;

  insert into site_agent_continuation_heads (
    run_id, generation, execution_number, api_provider, model_id,
    stable_prefix_hash, latest_sequence, response_count, status,
    purge_after, head, created_at, updated_at
  ) values (
    head_document->>'runId',
    target_generation,
    target_execution,
    head_document->>'apiProvider',
    head_document->>'modelId',
    head_document->>'stablePrefixHash',
    0,
    0,
    head_document->>'status',
    null,
    head_document,
    (head_document->>'createdAt')::timestamptz,
    (head_document->>'updatedAt')::timestamptz
  )
  on conflict (run_id) do update set
    generation = excluded.generation,
    execution_number = excluded.execution_number,
    api_provider = excluded.api_provider,
    model_id = excluded.model_id,
    stable_prefix_hash = excluded.stable_prefix_hash,
    latest_sequence = 0,
    response_count = 0,
    status = excluded.status,
    purge_after = null,
    head = excluded.head,
    updated_at = excluded.updated_at;
  return head_document;
end;
$$;

create or replace function public.close_site_agent_continuation(
  target_run_id text,
  target_execution_number integer,
  target_status text,
  target_purge_after timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
  status_value jsonb;
  updated_value jsonb;
begin
  if target_status not in ('awaiting_input', 'terminal') then
    raise exception 'invalid_continuation_status';
  end if;
  status_value := to_jsonb(target_status);
  select jsonb_set(head, '{status}', status_value, true)
    into updated_value
    from site_agent_continuation_heads
    where run_id = target_run_id
      and execution_number = target_execution_number;
  if updated_value is null then return false; end if;
  if target_purge_after is null then
    updated_value := updated_value - 'purgeAfter';
  else
    updated_value := jsonb_set(
      updated_value,
      '{purgeAfter}',
      to_jsonb(
        to_char(
          target_purge_after at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      ),
      true
    );
  end if;
  update site_agent_continuation_heads set
    status = target_status,
    purge_after = target_purge_after,
    head = updated_value,
    updated_at = now()
    where run_id = target_run_id
      and execution_number = target_execution_number;
  get diagnostics touched = row_count;
  return touched = 1;
end;
$$;

create or replace function public.set_current_public_build_input_if_authority_matches(
  target_site_id text,
  target_input_id text,
  target_owner_operational_revision integer,
  target_owner_intent_revision integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  perform 1
    from sites site_row
    join business_states state_row
      on state_row.business_id = site_row.business_id
    join site_intents intent_row
      on intent_row.site_id = site_row.id
    join site_public_build_inputs input_row
      on input_row.id = target_input_id
      and input_row.site_id = site_row.id
    where site_row.id = target_site_id
      and (state_row.state->>'ownerOperationalRevision')::integer =
        target_owner_operational_revision
      and (intent_row.intent->>'ownerIntentRevision')::integer =
        target_owner_intent_revision
      and input_row.owner_operational_revision =
        target_owner_operational_revision
      and input_row.owner_intent_revision =
        target_owner_intent_revision
    for update of site_row;
  if not found then return false; end if;

  update sites set
    current_public_build_input_id = target_input_id,
    updated_at = now()
    where id = target_site_id;
  get diagnostics touched = row_count;
  return touched = 1;
end;
$$;

create or replace function public.apply_prepared_provisional_authoring_context(
  target_expected_public_input_id text,
  target_expected_business_revision integer,
  source_documents jsonb,
  asset_documents jsonb,
  state_document jsonb,
  public_input_document jsonb,
  session_document jsonb,
  run_document jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_site sites;
  target_run site_agent_runs;
  current_state business_states;
  current_intent site_intents;
  item jsonb;
begin
  select * into target_site
    from sites
    where id = run_document->>'siteId'
    for update;
  if target_site.id is null
    or target_site.current_public_build_input_id is distinct from
      target_expected_public_input_id then
    return false;
  end if;

  select * into target_run
    from site_agent_runs
    where id = run_document->>'id'
    for update;
  select * into current_state
    from business_states
    where business_id = target_site.business_id
    for update;
  select * into current_intent
    from site_intents
    where site_id = target_site.id
    for update;
  if target_run.id is null
    or target_run.status <> 'running'
    or (target_run.run->>'executionNumber')::integer <>
      (run_document->>'executionNumber')::integer
    or current_state.revision <> target_expected_business_revision
    or (state_document->>'businessId') <> target_site.business_id
    or (state_document->>'siteId') <> target_site.id
    or (state_document->>'revision')::integer <> current_state.revision + 1
    or (state_document->>'ownerOperationalRevision')::integer <>
      (current_state.state->>'ownerOperationalRevision')::integer
    or public_input_document->>'siteId' <> target_site.id
    or public_input_document->>'businessId' <> target_site.business_id
    or (public_input_document->>'ownerOperationalRevision')::integer <>
      (state_document->>'ownerOperationalRevision')::integer
    or (public_input_document->>'ownerIntentRevision')::integer <>
      (current_intent.intent->>'ownerIntentRevision')::integer
    or session_document->>'id' <> target_run.session_id
    or session_document->>'siteId' <> target_site.id
    or session_document->>'publicBuildInputId' <> public_input_document->>'id'
    or run_document->>'publicBuildInputId' <> public_input_document->>'id' then
    return false;
  end if;

  for item in
    select value
    from jsonb_array_elements(coalesce(source_documents, '[]'::jsonb))
  loop
    if item->>'businessId' <> target_site.business_id then
      raise exception 'provisional_source_scope_mismatch';
    end if;
    insert into source_snapshots (
      id, business_id, schema_version, source_type, source_url,
      content_hash, captured_at, payload
    ) values (
      item->>'id',
      item->>'businessId',
      (item->>'schemaVersion')::integer,
      item->>'sourceType',
      nullif(item->>'sourceUrl', ''),
      item->>'contentHash',
      (item->>'capturedAt')::timestamptz,
      item->'payload'
    )
    on conflict (id) do nothing;
    if not exists (
      select 1 from source_snapshots
      where id = item->>'id'
        and content_hash = item->>'contentHash'
        and business_id = target_site.business_id
    ) then
      raise exception 'provisional_source_conflict';
    end if;
  end loop;

  for item in
    select value
    from jsonb_array_elements(coalesce(asset_documents, '[]'::jsonb))
  loop
    if item->>'businessId' <> target_site.business_id then
      raise exception 'provisional_asset_scope_mismatch';
    end if;
    insert into asset_revisions (
      id, asset_id, business_id, schema_version, content_hash, storage_path,
      public_url, mime_type, bytes, width, height, origin, provenance, created_at
    ) values (
      item->>'id',
      item->>'assetId',
      item->>'businessId',
      (item->>'schemaVersion')::integer,
      item->>'contentHash',
      item->>'storageKey',
      item->>'publicUrl',
      item->>'mimeType',
      (item->>'bytes')::integer,
      (item->>'width')::integer,
      (item->>'height')::integer,
      item->>'origin',
      item->'provenance',
      (item->>'createdAt')::timestamptz
    )
    on conflict (id) do nothing;
    if not exists (
      select 1 from asset_revisions
      where id = item->>'id'
        and content_hash = item->>'contentHash'
        and business_id = target_site.business_id
    ) then
      raise exception 'provisional_asset_conflict';
    end if;
  end loop;

  update business_states set
    schema_version = (state_document->>'schemaVersion')::integer,
    revision = (state_document->>'revision')::integer,
    state_hash = state_document->>'stateHash',
    state = state_document,
    updated_at = (state_document->>'updatedAt')::timestamptz
    where business_id = target_site.business_id;

  insert into site_public_build_inputs (
    id, site_id, business_id, schema_version,
    owner_operational_revision, owner_intent_revision,
    domain_context_id, domain_context_version, input_hash, input, created_at
  ) values (
    public_input_document->>'id',
    public_input_document->>'siteId',
    public_input_document->>'businessId',
    (public_input_document->>'schemaVersion')::integer,
    (public_input_document->>'ownerOperationalRevision')::integer,
    (public_input_document->>'ownerIntentRevision')::integer,
    public_input_document#>>'{domainContext,id}',
    public_input_document#>>'{domainContext,version}',
    public_input_document->>'inputHash',
    public_input_document,
    (public_input_document->>'createdAt')::timestamptz
  );
  insert into site_public_build_input_sources
    select public_input_document->>'id', value
    from jsonb_array_elements_text(public_input_document->'sourceSnapshotIds');
  insert into site_public_build_input_assets
    select public_input_document->>'id', value
    from jsonb_array_elements_text(public_input_document->'assetRevisionIds');
  insert into site_public_build_input_forms
    select public_input_document->>'id', value->>'id'
    from jsonb_array_elements(public_input_document->'forms');

  update sites set
    current_public_build_input_id = public_input_document->>'id',
    updated_at = now()
    where id = target_site.id;
  update site_agent_sessions set
    status = session_document->>'status',
    current_workspace_revision_id =
      nullif(session_document->>'currentWorkspaceRevisionId', ''),
    public_build_input_id = session_document->>'publicBuildInputId',
    lease_expires_at = (session_document->>'leaseExpiresAt')::timestamptz,
    rotate_at = (session_document->>'rotateAt')::timestamptz,
    updated_at = (session_document->>'updatedAt')::timestamptz
    where id = target_run.session_id
      and site_id = target_site.id;
  perform public.save_site_agent_run(run_document);
  return true;
end;
$$;

create or replace function public.apply_prepared_owner_authority_change(
  target_actor_id text,
  request_document jsonb,
  source_document jsonb default null,
  asset_document jsonb default null,
  state_document jsonb default null,
  intent_document jsonb default null,
  public_input_document jsonb default null,
  session_document jsonb default null,
  run_document jsonb default null,
  message_document jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_site sites;
  current_state business_states;
  current_intent site_intents;
  current_request control_plane_change_requests;
  item jsonb;
  owner_authority_advanced boolean := false;
begin
  select * into target_site
    from sites
    where id = request_document->>'siteId'
    for update;
  if target_site.id is null
    or target_site.owner_user_id is null
    or target_site.owner_user_id::text <> request_document->>'requestedBy'
    or target_site.business_id <> request_document->>'businessId'
    or request_document->>'status' <> 'applied'
    or (
      target_actor_id <> target_site.owner_user_id::text
      and request_document->>'decidedBy' <> target_actor_id
    ) then
    raise exception 'owner_authority_scope_mismatch';
  end if;

  select * into current_state
    from business_states
    where business_id = target_site.business_id
    for update;
  select * into current_intent
    from site_intents
    where site_id = target_site.id
    for update;
  if current_state.business_id is null
    or current_intent.id is null
    or current_state.revision <>
      (request_document->>'expectedBusinessRevision')::integer
    or current_intent.revision <>
      (request_document->>'expectedIntentRevision')::integer then
    raise exception 'stale_control_plane_change';
  end if;

  select * into current_request
    from control_plane_change_requests
    where id = request_document->>'id'
    for update;
  if current_request.id is not null and (
    current_request.site_id <> target_site.id
    or current_request.business_id <> target_site.business_id
    or current_request.requested_by <> request_document->>'requestedBy'
    or current_request.status not in ('pending', 'approved')
  ) then
    raise exception 'control_plane_request_conflict';
  end if;

  if source_document is not null then
    if source_document->>'businessId' <> target_site.business_id
      or source_document->>'sourceType' <> 'owner_input' then
      raise exception 'owner_source_scope_mismatch';
    end if;
    insert into source_snapshots (
      id, business_id, schema_version, source_type, source_url,
      content_hash, captured_at, payload
    ) values (
      source_document->>'id',
      source_document->>'businessId',
      (source_document->>'schemaVersion')::integer,
      source_document->>'sourceType',
      nullif(source_document->>'sourceUrl', ''),
      source_document->>'contentHash',
      (source_document->>'capturedAt')::timestamptz,
      source_document->'payload'
    );
  end if;

  if asset_document is not null then
    if asset_document->>'businessId' <> target_site.business_id then
      raise exception 'owner_asset_scope_mismatch';
    end if;
    insert into asset_revisions (
      id, asset_id, business_id, schema_version, content_hash, storage_path,
      public_url, mime_type, bytes, width, height, origin, provenance, created_at
    ) values (
      asset_document->>'id',
      asset_document->>'assetId',
      asset_document->>'businessId',
      (asset_document->>'schemaVersion')::integer,
      asset_document->>'contentHash',
      asset_document->>'storageKey',
      asset_document->>'publicUrl',
      asset_document->>'mimeType',
      (asset_document->>'bytes')::integer,
      (asset_document->>'width')::integer,
      (asset_document->>'height')::integer,
      asset_document->>'origin',
      asset_document->'provenance',
      (asset_document->>'createdAt')::timestamptz
    );
  end if;

  if state_document is not null then
    if state_document->>'businessId' <> target_site.business_id
      or state_document->>'siteId' <> target_site.id
      or (state_document->>'revision')::integer <> current_state.revision + 1
      or (state_document->>'ownerOperationalRevision')::integer <>
        (current_state.state->>'ownerOperationalRevision')::integer + 1 then
      raise exception 'prepared_business_state_mismatch';
    end if;
    update business_states set
      schema_version = (state_document->>'schemaVersion')::integer,
      revision = (state_document->>'revision')::integer,
      state_hash = state_document->>'stateHash',
      state = state_document,
      updated_at = (state_document->>'updatedAt')::timestamptz
      where business_id = target_site.business_id;
    owner_authority_advanced := true;
  end if;

  if intent_document is not null then
    if intent_document->>'siteId' <> target_site.id
      or (intent_document->>'revision')::integer <> current_intent.revision + 1
      or (intent_document->>'ownerIntentRevision')::integer not in (
        (current_intent.intent->>'ownerIntentRevision')::integer,
        (current_intent.intent->>'ownerIntentRevision')::integer + 1
      ) then
      raise exception 'prepared_site_intent_mismatch';
    end if;
    update site_intents set
      schema_version = (intent_document->>'schemaVersion')::integer,
      revision = (intent_document->>'revision')::integer,
      intent_hash = intent_document->>'intentHash',
      intent = intent_document,
      updated_at = (intent_document->>'updatedAt')::timestamptz
      where site_id = target_site.id;
    owner_authority_advanced := owner_authority_advanced
      or (intent_document->>'ownerIntentRevision')::integer >
        (current_intent.intent->>'ownerIntentRevision')::integer;
  end if;

  if public_input_document is not null then
    if public_input_document->>'siteId' <> target_site.id
      or public_input_document->>'businessId' <> target_site.business_id
      or (public_input_document->>'ownerOperationalRevision')::integer <>
        coalesce(
          (state_document->>'ownerOperationalRevision')::integer,
          (current_state.state->>'ownerOperationalRevision')::integer
        )
      or (public_input_document->>'ownerIntentRevision')::integer <>
        coalesce(
          (intent_document->>'ownerIntentRevision')::integer,
          (current_intent.intent->>'ownerIntentRevision')::integer
        ) then
      raise exception 'prepared_public_build_input_mismatch';
    end if;
    insert into site_public_build_inputs (
      id, site_id, business_id, schema_version,
      owner_operational_revision, owner_intent_revision,
      domain_context_id, domain_context_version, input_hash, input, created_at
    ) values (
      public_input_document->>'id',
      public_input_document->>'siteId',
      public_input_document->>'businessId',
      (public_input_document->>'schemaVersion')::integer,
      (public_input_document->>'ownerOperationalRevision')::integer,
      (public_input_document->>'ownerIntentRevision')::integer,
      public_input_document#>>'{domainContext,id}',
      public_input_document#>>'{domainContext,version}',
      public_input_document->>'inputHash',
      public_input_document,
      (public_input_document->>'createdAt')::timestamptz
    );
    insert into site_public_build_input_sources
      select public_input_document->>'id', value
      from jsonb_array_elements_text(public_input_document->'sourceSnapshotIds');
    insert into site_public_build_input_assets
      select public_input_document->>'id', value
      from jsonb_array_elements_text(public_input_document->'assetRevisionIds');
    insert into site_public_build_input_forms
      select public_input_document->>'id', value->>'id'
      from jsonb_array_elements(public_input_document->'forms');
    update sites set
      current_public_build_input_id = public_input_document->>'id',
      updated_at = now()
      where id = target_site.id;
  end if;

  if owner_authority_advanced then
    update site_versions set
      status = 'stale',
      stale_reason = 'owner_authority_changed',
      version = jsonb_set(
        jsonb_set(version, '{status}', '"stale"', true),
        '{staleReason}',
        '"owner_authority_changed"',
        true
      )
      where site_id = target_site.id
        and status = 'candidate';
  end if;

  if session_document is not null then
    if session_document->>'siteId' <> target_site.id
      or session_document#>>'{principal,kind}' <> 'owner'
      or session_document#>>'{principal,id}' <> target_site.owner_user_id::text
      or (
        public_input_document is not null
        and session_document->>'publicBuildInputId' <>
          public_input_document->>'id'
    ) then
      raise exception 'prepared_session_mismatch';
    end if;
    if exists (
      select 1
      from site_agent_sessions session_row
      where session_row.id = session_document->>'id'
        and (
          session_row.site_id <> target_site.id
          or session_row.principal_kind <> 'owner'
          or session_row.principal_id <> target_site.owner_user_id::text
        )
    ) then
      raise exception 'prepared_session_scope_conflict';
    end if;
    insert into site_agent_sessions (
      id, site_id, principal_kind, principal_id, schema_version, status,
      current_workspace_revision_id, public_build_input_id, sandbox_provider,
      sandbox_id, sandbox_last_started_at, sandbox_last_destroyed_at,
      sandbox_provisioned_ms, sandbox_destroy_attempts, lease_token_hash,
      lease_expires_at, rotate_at, created_at, updated_at
    ) values (
      session_document->>'id',
      session_document->>'siteId',
      session_document#>>'{principal,kind}',
      session_document#>>'{principal,id}',
      session_document->>'schemaVersion',
      session_document->>'status',
      nullif(session_document->>'currentWorkspaceRevisionId', ''),
      session_document->>'publicBuildInputId',
      session_document->>'sandboxProvider',
      nullif(session_document->>'sandboxId', ''),
      nullif(session_document->>'sandboxLastStartedAt', '')::timestamptz,
      nullif(session_document->>'sandboxLastDestroyedAt', '')::timestamptz,
      coalesce((session_document->>'sandboxProvisionedMs')::bigint, 0),
      coalesce((session_document->>'sandboxDestroyAttempts')::integer, 0),
      session_document->>'leaseTokenHash',
      (session_document->>'leaseExpiresAt')::timestamptz,
      (session_document->>'rotateAt')::timestamptz,
      (session_document->>'createdAt')::timestamptz,
      (session_document->>'updatedAt')::timestamptz
    )
    on conflict (id) do update set
      status = excluded.status,
      current_workspace_revision_id = excluded.current_workspace_revision_id,
      public_build_input_id = excluded.public_build_input_id,
      sandbox_provider = excluded.sandbox_provider,
      sandbox_id = excluded.sandbox_id,
      sandbox_last_started_at = excluded.sandbox_last_started_at,
      sandbox_last_destroyed_at = excluded.sandbox_last_destroyed_at,
      sandbox_provisioned_ms = excluded.sandbox_provisioned_ms,
      sandbox_destroy_attempts = excluded.sandbox_destroy_attempts,
      lease_token_hash = excluded.lease_token_hash,
      lease_expires_at = excluded.lease_expires_at,
      rotate_at = excluded.rotate_at,
      updated_at = excluded.updated_at;
  end if;

  if (run_document is null) <> (message_document is null) then
    raise exception 'prepared_authority_run_pair_required';
  end if;
  if run_document is not null then
    if session_document is null
      or run_document->>'siteId' <> target_site.id
      or run_document->>'sessionId' <> session_document->>'id'
      or (
        request_document->>'targetAuthority' = 'workspace'
        and (
          run_document->>'publicBuildInputId' <>
            session_document->>'publicBuildInputId'
          or run_document#>>'{request,kind}' <> 'owner_instruction'
          or not (
            coalesce(run_document#>'{request,messageIds}', '[]'::jsonb)
            ? (message_document->>'id')
          )
        )
      )
      or (
        request_document->>'targetAuthority' <> 'workspace'
        and (
          public_input_document is null
          or run_document->>'publicBuildInputId' <>
            public_input_document->>'id'
          or run_document#>>'{request,kind}' <> 'authority_refresh'
          or not (
            coalesce(run_document#>'{request,changeRequestIds}', '[]'::jsonb)
            ? (request_document->>'id')
          )
        )
      )
      or message_document->>'runId' <> run_document->>'id'
      or message_document->>'sessionId' <> session_document->>'id' then
      raise exception 'prepared_authority_run_mismatch';
    end if;
    perform public.enqueue_site_agent_run(run_document);
    insert into site_agent_messages (
      id, schema_version, session_id, run_id, role, content, selection, created_at
    ) values (
      message_document->>'id',
      message_document->>'schemaVersion',
      message_document->>'sessionId',
      message_document->>'runId',
      message_document->>'role',
      message_document->>'content',
      message_document->'selection',
      (message_document->>'createdAt')::timestamptz
    );
  end if;

  insert into control_plane_change_requests (
    id, business_id, site_id, schema_version, target_authority,
    change_kind, payload, impact, status, expected_business_revision,
    expected_intent_revision, requested_by, requested_at, decided_by,
    decided_at, failure_reason
  ) values (
    request_document->>'id',
    request_document->>'businessId',
    request_document->>'siteId',
    request_document->>'schemaVersion',
    request_document->>'targetAuthority',
    request_document#>>'{payload,kind}',
    request_document->'payload',
    request_document->>'impact',
    request_document->>'status',
    (request_document->>'expectedBusinessRevision')::integer,
    (request_document->>'expectedIntentRevision')::integer,
    request_document->>'requestedBy',
    (request_document->>'requestedAt')::timestamptz,
    nullif(request_document->>'decidedBy', ''),
    nullif(request_document->>'decidedAt', '')::timestamptz,
    nullif(request_document->>'failureReason', '')
  )
  on conflict (id) do update set
    status = excluded.status,
    decided_by = excluded.decided_by,
    decided_at = excluded.decided_at,
    failure_reason = excluded.failure_reason;

  return jsonb_build_object(
    'request', request_document,
    'run', run_document
  );
end;
$$;

revoke all on function public.bootstrap_site_authoring(
  uuid,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
) from public, anon, authenticated;
revoke all on function public.enqueue_site_agent_request(jsonb,jsonb)
  from public, anon, authenticated;
revoke all on function public.claim_next_site_agent_run(text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.append_site_agent_continuation(jsonb,jsonb)
  from public, anon, authenticated;
revoke all on function public.reset_site_agent_continuation(jsonb)
  from public, anon, authenticated;
revoke all on function public.close_site_agent_continuation(text,integer,text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.set_current_public_build_input_if_authority_matches(
  text,text,integer,integer
) from public, anon, authenticated;
revoke all on function public.apply_prepared_provisional_authoring_context(
  text,integer,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
) from public, anon, authenticated;
revoke all on function public.apply_prepared_owner_authority_change(
  text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
) from public, anon, authenticated;

grant execute on function public.bootstrap_site_authoring(
  uuid,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
) to service_role;
grant execute on function public.enqueue_site_agent_request(jsonb,jsonb)
  to service_role;
grant execute on function public.claim_next_site_agent_run(text,timestamptz)
  to service_role;
grant execute on function public.append_site_agent_continuation(jsonb,jsonb)
  to service_role;
grant execute on function public.reset_site_agent_continuation(jsonb)
  to service_role;
grant execute on function public.close_site_agent_continuation(text,integer,text,timestamptz)
  to service_role;
grant execute on function public.set_current_public_build_input_if_authority_matches(
  text,text,integer,integer
) to service_role;
grant execute on function public.apply_prepared_provisional_authoring_context(
  text,integer,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
) to service_role;
grant execute on function public.apply_prepared_owner_authority_change(
  text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
) to service_role;

commit;
