-- Serialize timestamptz as JSON directly. Casting to text produces a space
-- separator and +00 offset, which is not the public contract's ISO datetime.
-- No stored row or retained payload is rewritten by this forward migration.
create or replace function public.promote_site_version(target_version_id text, actor_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_version site_versions;
  target_site sites;
  target_artifact site_build_artifacts;
  target_input site_public_build_inputs;
  target_workspace site_workspace_revisions;
  current_owner_operational_revision integer;
  current_owner_intent_revision integer;
  previous_id text;
begin
  select * into target_version
    from site_versions
    where id = target_version_id and status = 'candidate'
    for update;
  if target_version.id is null then raise exception 'version_not_promotable'; end if;

  select * into target_site from sites
    where id = target_version.site_id and owner_user_id::text = actor_id
    for update;
  if target_site.id is null then raise exception 'site_owner_required'; end if;

  select * into target_artifact from site_build_artifacts
    where id = target_version.artifact_id
      and artifact_hash = target_version.version->>'artifactHash'
      and hard_gate_status = 'passed'
      and public_build_input_id = target_version.public_build_input_id
      and owner_operational_revision = target_version.owner_operational_revision
      and owner_intent_revision = target_version.owner_intent_revision;
  select * into target_input from site_public_build_inputs
    where id = target_version.public_build_input_id;
  select * into target_workspace from site_workspace_revisions
    where id = target_version.workspace_revision_id
      and site_id = target_site.id
      and public_build_input_id = target_version.public_build_input_id
      and owner_operational_revision = target_version.owner_operational_revision
      and owner_intent_revision = target_version.owner_intent_revision;
  select (state->>'ownerOperationalRevision')::integer
    into current_owner_operational_revision
    from business_states where business_id = target_site.business_id;
  select (intent->>'ownerIntentRevision')::integer into current_owner_intent_revision
    from site_intents where site_id = target_site.id;

  if target_artifact.id is null
    or target_input.id is null
    or target_workspace.id is null
    or target_artifact.workspace_revision_id <> target_workspace.id
    or not exists (
      select 1
      from trusted_runtime_patches runtime_patch
      where runtime_patch.id = target_artifact.runtime_patch_at_finalization
        and runtime_patch.series_id = target_artifact.runtime_series_id
        and runtime_patch.security_status = 'audited'
        and runtime_patch.compatibility_status = 'passed'
    )
    or exists (
      select 1
      from site_version_forms version_form
      join form_definitions form_definition on form_definition.id = version_form.form_definition_id
      where version_form.version_id = target_version.id
        and (form_definition.site_id <> target_site.id or form_definition.status = 'retired')
    )
    or exists (
      select 1
      from site_version_assets version_asset
      join asset_revisions asset_revision on asset_revision.id = version_asset.asset_revision_id
      where version_asset.version_id = target_version.id
        and asset_revision.business_id <> target_site.business_id
    )
    or exists (
      select 1
      from site_version_sources version_source
      join source_snapshots source_snapshot on source_snapshot.id = version_source.source_snapshot_id
      where version_source.version_id = target_version.id
        and source_snapshot.business_id <> target_site.business_id
    ) then
    raise exception 'candidate_integrity_failed';
  end if;
  if target_version.owner_operational_revision <> current_owner_operational_revision
    or target_version.owner_intent_revision <> current_owner_intent_revision
    or target_input.owner_operational_revision <> current_owner_operational_revision
    or target_input.owner_intent_revision <> current_owner_intent_revision then
    raise exception 'owner_authority_changed';
  end if;

  select id into previous_id from site_versions
    where site_id = target_site.id and status = 'published'
    for update;
  update site_versions set
    status = 'superseded',
    version = jsonb_set(version, '{status}', '"superseded"', true)
    where id = previous_id;
  update site_versions set
    status = 'published',
    published_at = now(),
    replaced_version_id = previous_id,
    version = jsonb_set(
      jsonb_set(version - 'staleReason', '{status}', '"published"', true),
      '{publishedAt}', to_jsonb(now()), true
    )
    where id = target_version.id;
  update form_definitions set status = 'published'
    where id in (
      select form_definition_id from site_version_forms
      where version_id = target_version.id
    );
  update sites set
    status = 'active',
    published_version_id = target_version.id,
    updated_at = now()
    where id = target_site.id;
  return jsonb_build_object(
    'siteId', target_site.id,
    'versionId', target_version.id,
    'actorId', actor_id
  );
end;
$$;

revoke all on function public.promote_site_version(text,text)
  from public, anon, authenticated;
grant execute on function public.promote_site_version(text,text) to service_role;
