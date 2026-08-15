update public.operator_settings
set value = jsonb_build_object(
      'siteAgentProvider', 'openai',
      'siteAgentModel', 'gpt-5.6-luna'
    ),
    version = version + 1,
    updated_by = 'migration:checkpointed_verification_and_luna_authoring',
    updated_at = now()
where key = 'site_authoring_models'
  and value is distinct from jsonb_build_object(
    'siteAgentProvider', 'openai',
    'siteAgentModel', 'gpt-5.6-luna'
  );

create or replace function public.checkpoint_site_agent_run_workspace(
  checkpoint_document jsonb,
  run_document jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_run public.site_agent_runs;
  current_session public.site_agent_sessions;
begin
  select * into current_run
    from public.site_agent_runs
    where id = run_document->>'id'
    for update;
  if current_run.id is null
    or current_run.status <> 'running'
    or (current_run.run->>'executionNumber')::integer <> (checkpoint_document->>'executionNumber')::integer
    or run_document->>'status' <> 'running'
    or run_document->>'resumeCheckpointId' <> checkpoint_document->>'id'
    or run_document->>'sandboxDeploymentId' <> checkpoint_document->>'sandboxDeploymentId'
    or checkpoint_document->>'runId' <> current_run.id
    or checkpoint_document->>'publicBuildInputId' <> current_run.run->>'publicBuildInputId'
    or nullif(checkpoint_document->>'baseWorkspaceRevisionId', '')
      is distinct from current_run.exact_parent_revision_id then
    raise exception 'checkpoint_execution_fenced';
  end if;

  select * into current_session
    from public.site_agent_sessions
    where id = current_run.session_id
    for update;
  if current_session.id is null
    or current_session.sandbox_id is distinct from checkpoint_document->>'sandboxId'
    or current_session.sandbox_deployment_id is distinct from checkpoint_document->>'sandboxDeploymentId'
    or current_session.current_workspace_revision_id is distinct from current_run.exact_parent_revision_id
    or current_session.public_build_input_id <> checkpoint_document->>'publicBuildInputId' then
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

  update public.site_agent_runs
  set sandbox_deployment_id = checkpoint_document->>'sandboxDeploymentId',
      resume_checkpoint_id = checkpoint_document->>'id',
      run = run_document
  where id = current_run.id
    and status = 'running'
    and (run->>'executionNumber')::integer = (checkpoint_document->>'executionNumber')::integer;
  if not found then raise exception 'checkpoint_execution_fenced'; end if;
  return run_document;
end;
$$;

create or replace function public.requeue_checkpointed_site_agent_run(run_document jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_run public.site_agent_runs;
  current_checkpoint public.site_agent_workspace_checkpoints;
begin
  select * into current_run
    from public.site_agent_runs
    where id = run_document->>'id'
    for update;
  if current_run.id is null
    or current_run.status <> 'failed'
    or coalesce((current_run.run->>'retryableByOwner')::boolean, false) is not true
    or current_run.resume_checkpoint_id is null
    or (current_run.run->>'executionNumber')::integer <> (run_document->>'executionNumber')::integer
    or run_document->>'status' <> 'queued'
    or run_document->>'stage' <> 'queued'
    or run_document->>'resumeCheckpointId' <> current_run.resume_checkpoint_id
    or run_document->>'id' <> current_run.id
    or run_document->>'sessionId' <> current_run.session_id
    or run_document->>'siteId' <> current_run.site_id
    or run_document->>'publicBuildInputId' <> current_run.run->>'publicBuildInputId'
    or nullif(run_document->>'exactParentRevisionId', '') is distinct from current_run.exact_parent_revision_id then
    return null;
  end if;

  select * into current_checkpoint
    from public.site_agent_workspace_checkpoints
    where id = current_run.resume_checkpoint_id
      and run_id = current_run.id
    for update;
  if current_checkpoint.id is null then return null; end if;

  update public.site_agent_runs
  set status = 'queued',
      sandbox_deployment_id = null,
      model_id = run_document->>'modelId',
      run = run_document,
      started_at = (run_document->>'startedAt')::timestamptz,
      completed_at = null
  where id = current_run.id
    and status = 'failed'
    and resume_checkpoint_id = current_checkpoint.id;
  if not found then return null; end if;
  return run_document;
end;
$$;

revoke all on function public.checkpoint_site_agent_run_workspace(jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.requeue_checkpointed_site_agent_run(jsonb) from public, anon, authenticated;
grant execute on function public.checkpoint_site_agent_run_workspace(jsonb,jsonb) to service_role;
grant execute on function public.requeue_checkpointed_site_agent_run(jsonb) to service_role;
