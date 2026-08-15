-- Pre-launch clean cut to one owner-scoped, model-led site-authoring path.
-- Run `npm run maintenance:reset-prelaunch-site-authoring` in report mode,
-- review it, and apply its exact confirmation before this migration.

begin;

do $$
begin
  if exists (select 1 from public.business_states limit 1)
    or exists (select 1 from public.site_public_build_inputs limit 1)
    or exists (select 1 from public.site_workspace_revisions limit 1)
    or exists (select 1 from public.site_build_artifacts limit 1)
    or exists (select 1 from public.site_versions limit 1)
    or exists (select 1 from public.external_authoring_executions limit 1)
    or exists (select 1 from public.external_authoring_credentials limit 1)
    or exists (select 1 from public.external_authoring_batches limit 1)
    or exists (select 1 from public.generation_experiments limit 1)
    or exists (select 1 from public.model_bakeoff_experiments limit 1) then
    raise exception 'simplified_site_authoring_requires_reviewed_prelaunch_reset';
  end if;
end
$$;

alter table public.site_public_build_inputs
  rename column business_state_revision to owner_operational_revision;
alter table public.site_public_build_inputs
  rename column site_intent_revision to owner_intent_revision;

alter table public.site_workspace_revisions
  add column public_build_input_id text not null
    references public.site_public_build_inputs(id) on delete restrict,
  add column owner_operational_revision integer not null
    check (owner_operational_revision > 0),
  add column owner_intent_revision integer not null
    check (owner_intent_revision > 0);

alter table public.site_build_artifacts
  add column owner_operational_revision integer not null
    check (owner_operational_revision > 0),
  add column owner_intent_revision integer not null
    check (owner_intent_revision > 0);

alter table public.site_versions
  add column owner_operational_revision integer not null
    check (owner_operational_revision > 0),
  add column owner_intent_revision integer not null
    check (owner_intent_revision > 0);

alter table public.external_authoring_credentials
  add column owner_user_id uuid not null,
  add column site_id text not null references public.sites(id) on delete restrict;
create index external_authoring_credentials_owner_site_idx
  on public.external_authoring_credentials(owner_user_id, site_id)
  where status = 'active';

alter table public.external_authoring_executions
  add column site_id text not null references public.sites(id) on delete restrict,
  add column owner_user_id uuid not null;
alter table public.external_authoring_executions
  drop constraint if exists external_authoring_executions_batch_item_id_fkey,
  drop constraint if exists external_authoring_executions_batch_item_id_key,
  drop column batch_item_id;
create index external_authoring_executions_owner_site_idx
  on public.external_authoring_executions(owner_user_id, site_id, created_at desc);

do $$
declare
  definition text;
begin
  select pg_get_functiondef(
    'public.bootstrap_site(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ) into definition;
  definition := replace(definition, 'business_state_revision', 'owner_operational_revision');
  definition := replace(definition, 'site_intent_revision', 'owner_intent_revision');
  definition := replace(definition, 'businessStateRevision', 'ownerOperationalRevision');
  definition := replace(definition, 'siteIntentRevision', 'ownerIntentRevision');
  if position('business_state_revision' in definition) > 0
    or position('site_intent_revision' in definition) > 0 then
    raise exception 'bootstrap_site_owner_authority_rewrite_failed';
  end if;
  execute definition;
end
$$;

do $$
declare
  definition text;
  old_media_stale text := $block$
    update site_versions set
      status = 'stale',
      stale_reason = 'stale_input',
      version = jsonb_set(jsonb_set(version, '{status}', '"stale"', true), '{staleReason}', '"stale_input"', true)
      where site_id = target_site.id and status = 'candidate';$block$;
  new_media_supersede text := $block$
    update site_versions set
      status = 'superseded',
      stale_reason = null,
      version = jsonb_set(version - 'staleReason', '{status}', '"superseded"', true)
      where site_id = target_site.id and status = 'candidate';$block$;
  old_external_batch_updates text := $block$
    update external_authoring_batch_items set
      candidate_version_id = final_version->>'id',
      preview_id = preview_grant_document->>'id',
      updated_at = now()
      where id = external_document->>'batchItemId';
    update outbound_prospects set preview_id = preview_grant_document->>'id'
      where id = (
        select prospect_id from external_authoring_batch_items
        where id = external_document->>'batchItemId'
      );$block$;
  old_workspace_columns text := $block$id, site_id, schema_version, parent_revision_id, revision_number, source_hash,
    source_archive_key, files, created_by_kind, created_by_id, created_at$block$;
  new_workspace_columns text := $block$id, site_id, schema_version, parent_revision_id, revision_number, source_hash,
    public_build_input_id, owner_operational_revision, owner_intent_revision,
    source_archive_key, files, created_by_kind, created_by_id, created_at$block$;
  old_workspace_values text := $block$revision_document->>'sourceHash', revision_document->>'sourceArchiveKey', revision_document->'files'$block$;
  new_workspace_values text := $block$revision_document->>'sourceHash', revision_document->>'publicBuildInputId',
    (revision_document->>'ownerOperationalRevision')::integer,
    (revision_document->>'ownerIntentRevision')::integer,
    revision_document->>'sourceArchiveKey', revision_document->'files'$block$;
  old_artifact_columns text := $block$id, site_id, workspace_revision_id, public_build_input_id, runtime_series_id,
    runtime_patch_at_finalization$block$;
  new_artifact_columns text := $block$id, site_id, workspace_revision_id, public_build_input_id,
    owner_operational_revision, owner_intent_revision, runtime_series_id,
    runtime_patch_at_finalization$block$;
  old_artifact_values text := $block$artifact_document->>'publicBuildInputId', artifact_document->>'runtimeSeriesId'$block$;
  new_artifact_values text := $block$artifact_document->>'publicBuildInputId',
    (artifact_document->>'ownerOperationalRevision')::integer,
    (artifact_document->>'ownerIntentRevision')::integer,
    artifact_document->>'runtimeSeriesId'$block$;
  old_version_columns text := $block$public_build_input_id, version, created_by_kind$block$;
  new_version_columns text := $block$public_build_input_id, owner_operational_revision, owner_intent_revision,
    version, created_by_kind$block$;
  old_version_values text := $block$final_version->>'workspaceRevisionId', final_version->>'publicBuildInputId', final_version,$block$;
  new_version_values text := $block$final_version->>'workspaceRevisionId', final_version->>'publicBuildInputId',
    (final_version->>'ownerOperationalRevision')::integer,
    (final_version->>'ownerIntentRevision')::integer, final_version,$block$;
  version_assignment text := $block$final_version := jsonb_set(version_document, '{number}', to_jsonb(assigned_version_number), true);$block$;
  authority_assignment text := $block$final_version := jsonb_set(version_document, '{number}', to_jsonb(assigned_version_number), true);
  if not exists (
    select 1
    from business_states state_row
    join site_intents intent_row on intent_row.site_id = target_site.id
    where state_row.business_id = target_site.business_id
      and (state_row.state->>'ownerOperationalRevision')::integer =
        (final_version->>'ownerOperationalRevision')::integer
      and (intent_row.intent->>'ownerIntentRevision')::integer =
        (final_version->>'ownerIntentRevision')::integer
  ) then
    final_version := jsonb_set(
      jsonb_set(final_version, '{status}', '"stale"', true),
      '{staleReason}', '"owner_authority_changed"', true
    );
  else
    update site_versions set
      status = 'superseded',
      stale_reason = null,
      version = jsonb_set(version - 'staleReason', '{status}', '"superseded"', true)
      where site_id = target_site.id and status = 'candidate';
  end if;$block$;
begin
  select pg_get_functiondef(
    'public.finalize_verified_authoring(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ) into definition;

  definition := replace(definition, old_media_stale, new_media_supersede);
  definition := replace(definition, 'business_state_revision', 'owner_operational_revision');
  definition := replace(definition, 'site_intent_revision', 'owner_intent_revision');
  definition := replace(definition, 'businessStateRevision', 'ownerOperationalRevision');
  definition := replace(definition, 'siteIntentRevision', 'ownerIntentRevision');
  definition := replace(definition, old_workspace_columns, new_workspace_columns);
  definition := replace(definition, old_workspace_values, new_workspace_values);
  definition := replace(definition, old_artifact_columns, new_artifact_columns);
  definition := replace(definition, old_artifact_values, new_artifact_values);
  definition := replace(definition, old_version_columns, new_version_columns);
  definition := replace(definition, old_version_values, new_version_values);
  definition := replace(definition, version_assignment, authority_assignment);
  definition := replace(definition, old_external_batch_updates, '');

  if position('business_state_revision' in definition) > 0
    or position('site_intent_revision' in definition) > 0
    or position('external_authoring_batch_items' in definition) > 0
    or position('revision_document->>''publicBuildInputId''' in definition) = 0
    or position('owner_authority_changed' in definition) = 0 then
    raise exception 'finalize_verified_authoring_owner_authority_rewrite_failed';
  end if;
  execute definition;
end
$$;

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
      '{publishedAt}', to_jsonb(now()::text), true
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

drop function if exists public.claim_external_batch_preparation(text);
drop function if exists public.claim_next_external_authoring(text,text,text,text,timestamptz,timestamptz);
drop function if exists public.cancel_external_authoring_batch(text,timestamptz);

drop table public.generation_experiment_runs;
drop table public.generation_experiments;
drop table public.model_bakeoff_runs;
drop table public.model_bakeoff_experiments;
drop table public.external_authoring_batch_items;
drop table public.external_authoring_batches;

commit;
