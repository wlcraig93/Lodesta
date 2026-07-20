create or replace function commit_verified_site_build_v1(
  revision_document jsonb,
  artifact_document jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_site sites%rowtype;
  expected_parent text;
  revision_id text;
  artifact_id text;
begin
  revision_id := revision_document ->> 'id';
  artifact_id := artifact_document ->> 'id';
  expected_parent := nullif(revision_document ->> 'parentRevisionId', '');

  if revision_document ->> 'schemaVersion' <> 'site-workspace-revision-v1' then
    raise exception 'invalid workspace revision schema';
  end if;
  if artifact_document ->> 'schemaVersion' <> 'site-build-artifact-v1' then
    raise exception 'invalid build artifact schema';
  end if;
  if artifact_document -> 'qa' ->> 'hardGate' <> 'passed' then
    raise exception 'only hard-gate-passed builds can be committed';
  end if;
  if artifact_document ->> 'workspaceRevisionId' <> revision_id
    or artifact_document ->> 'siteId' <> revision_document ->> 'siteId' then
    raise exception 'verified artifact and workspace revision do not match';
  end if;

  select * into target_site
  from sites
  where id = revision_document ->> 'siteId'
  for update;
  if target_site.id is null then raise exception 'site not found'; end if;
  if target_site.current_workspace_revision_id is distinct from expected_parent then
    raise exception 'stale_parent_revision';
  end if;
  if exists (select 1 from site_workspace_revisions where id = revision_id) then
    raise exception 'workspace revision already exists';
  end if;
  if exists (select 1 from site_build_artifacts where id = artifact_id) then
    raise exception 'build artifact already exists';
  end if;

  insert into site_workspace_revisions (
    id, site_id, schema_version, parent_revision_id, revision_number, source_hash,
    source_archive_key, files, created_by_kind, created_by_id, created_at
  ) values (
    revision_id,
    revision_document ->> 'siteId',
    revision_document ->> 'schemaVersion',
    expected_parent,
    (revision_document ->> 'revisionNumber')::integer,
    revision_document ->> 'sourceHash',
    revision_document ->> 'sourceArchiveKey',
    revision_document -> 'files',
    revision_document -> 'createdBy' ->> 'kind',
    revision_document -> 'createdBy' ->> 'id',
    (revision_document ->> 'createdAt')::timestamptz
  );

  insert into site_build_artifacts (
    id, site_id, workspace_revision_id, public_build_input_id, runtime_series_id,
    runtime_patch_at_finalization, schema_version, artifact_hash, storage_prefix,
    artifact, hard_gate_status, toolchain_version, sandbox_image_digest, created_at
  ) values (
    artifact_id,
    artifact_document ->> 'siteId',
    artifact_document ->> 'workspaceRevisionId',
    artifact_document ->> 'publicBuildInputId',
    artifact_document ->> 'runtimeSeriesId',
    artifact_document ->> 'runtimePatchAtFinalization',
    artifact_document ->> 'schemaVersion',
    artifact_document ->> 'artifactHash',
    artifact_document ->> 'storagePrefix',
    artifact_document,
    artifact_document -> 'qa' ->> 'hardGate',
    artifact_document ->> 'toolchainVersion',
    artifact_document ->> 'sandboxImageDigest',
    (artifact_document ->> 'createdAt')::timestamptz
  );

  update sites
  set current_workspace_revision_id = revision_id,
      updated_at = (revision_document ->> 'createdAt')::timestamptz
  where id = target_site.id;

  return jsonb_build_object('ok', true, 'revisionId', revision_id, 'artifactId', artifact_id);
end;
$$;

revoke all on function commit_verified_site_build_v1(jsonb, jsonb) from public;
grant execute on function commit_verified_site_build_v1(jsonb, jsonb) to service_role;

drop function if exists append_site_workspace_revision_v1(jsonb);
