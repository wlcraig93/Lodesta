-- A retained research source can outlive every provisional media reference.
-- Bind the resulting source-only public input inside the existing verified
-- finalization transaction; do not manufacture a media adoption or mutate a
-- previously retained input.

begin;

do $$
declare
  old_signature regprocedure :=
    'public.finalize_verified_authoring(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure;
  definition text;
  parameter_anchor constant text :=
    'media_adoption_document jsonb DEFAULT NULL::jsonb';
  finalization_anchor constant text :=
    'if media_adoption_document is not null then';
  prepared_block constant text := $block$
  if prepared_input_document is not null then
    if media_adoption_document is not null then raise exception 'finalization_input_binding_conflict'; end if;
    if prepared_input_document->>'expectedPublicBuildInputId' is null
      or prepared_input_document#>>'{publicBuildInput,id}' is null then
      raise exception 'invalid_prepared_source_input';
    end if;
    select input into retained_public_input from public.site_public_build_inputs
      where id = prepared_input_document->>'expectedPublicBuildInputId';
    select run into retained_run_document from public.site_agent_runs
      where id = run_document->>'id' and site_id = target_site.id
      and status = 'running'
      and coalesce((run->>'executionNumber')::integer, 0) =
        coalesce((run_document->>'executionNumber')::integer, 0)
      for update;
    select state into current_business_state from public.business_states
      where business_id = target_site.business_id;
    select intent into current_site_intent from public.site_intents
      where site_id = target_site.id;
    if retained_public_input is null
      or retained_run_document is null
      or target_site.current_public_build_input_id is distinct from prepared_input_document->>'expectedPublicBuildInputId'
      or retained_run_document->>'publicBuildInputId' is distinct from prepared_input_document->>'expectedPublicBuildInputId'
      or run_document->>'publicBuildInputId' is distinct from prepared_input_document#>>'{publicBuildInput,id}'
      or session_document->>'siteId' is distinct from target_site.id
      or session_document->>'publicBuildInputId' is distinct from prepared_input_document#>>'{publicBuildInput,id}'
      or current_business_state->>'ownerOperationalRevision' is distinct from prepared_input_document#>>'{publicBuildInput,ownerOperationalRevision}'
      or current_site_intent->>'ownerIntentRevision' is distinct from prepared_input_document#>>'{publicBuildInput,ownerIntentRevision}'
      or prepared_input_document#>>'{publicBuildInput,siteId}' is distinct from target_site.id
      or prepared_input_document#>>'{publicBuildInput,businessId}' is distinct from target_site.business_id
      or prepared_input_document#>>'{publicBuildInput,ownerOperationalRevision}' is distinct from revision_document->>'ownerOperationalRevision'
      or prepared_input_document#>>'{publicBuildInput,ownerIntentRevision}' is distinct from revision_document->>'ownerIntentRevision'
      or prepared_input_document#>>'{publicBuildInput,id}' is distinct from artifact_document->>'publicBuildInputId'
      or prepared_input_document#>>'{publicBuildInput,id}' is distinct from version_document->>'publicBuildInputId'
      or ((prepared_input_document->'publicBuildInput') - 'id' - 'inputHash' - 'createdAt' - 'sourceSnapshotIds')
        is distinct from (retained_public_input - 'id' - 'inputHash' - 'createdAt' - 'sourceSnapshotIds')
      or not ((prepared_input_document#>'{publicBuildInput,sourceSnapshotIds}') @> (retained_public_input->'sourceSnapshotIds'))
      or (retained_public_input->'sourceSnapshotIds') @> (prepared_input_document#>'{publicBuildInput,sourceSnapshotIds}')
      or exists (select 1 from public.site_public_build_inputs where id = prepared_input_document#>>'{publicBuildInput,id}') then
      raise exception 'stale_prepared_source_input';
    end if;
    insert into public.site_public_build_inputs (
      id, site_id, business_id, schema_version, owner_operational_revision,
      owner_intent_revision, input_hash, input, created_at
    ) values (
      prepared_input_document#>>'{publicBuildInput,id}', target_site.id, target_site.business_id,
      (prepared_input_document#>>'{publicBuildInput,schemaVersion}')::integer,
      (prepared_input_document#>>'{publicBuildInput,ownerOperationalRevision}')::integer,
      (prepared_input_document#>>'{publicBuildInput,ownerIntentRevision}')::integer,
      prepared_input_document#>>'{publicBuildInput,inputHash}', prepared_input_document->'publicBuildInput',
      (prepared_input_document#>>'{publicBuildInput,createdAt}')::timestamptz
    );
    insert into public.site_public_build_input_sources
      select prepared_input_document#>>'{publicBuildInput,id}', value
      from jsonb_array_elements_text(prepared_input_document#>'{publicBuildInput,sourceSnapshotIds}');
    insert into public.site_public_build_input_assets
      select prepared_input_document#>>'{publicBuildInput,id}', value
      from jsonb_array_elements_text(prepared_input_document#>'{publicBuildInput,assetRevisionIds}');
    insert into public.site_public_build_input_forms
      select prepared_input_document#>>'{publicBuildInput,id}', value->>'id'
      from jsonb_array_elements(prepared_input_document#>'{publicBuildInput,forms}');
    update public.site_versions set
      status = 'superseded',
      stale_reason = null,
      version = jsonb_set(version - 'staleReason', '{status}', '"superseded"', true)
      where site_id = target_site.id and status = 'candidate';
    update public.sites set current_public_build_input_id = prepared_input_document#>>'{publicBuildInput,id}'
      where id = target_site.id;
  end if;
$block$;
begin
  select pg_get_functiondef(old_signature) into definition;
  if definition is null
    or position(parameter_anchor in definition) = 0
    or position(parameter_anchor in replace(definition, parameter_anchor, '')) > 0
    or position(finalization_anchor in definition) = 0 then
    raise exception 'prepared_source_input_finalizer_anchor_missing';
  end if;
  definition := replace(
    definition,
    parameter_anchor,
    'prepared_input_document jsonb DEFAULT NULL::jsonb,' || E'\n  ' || parameter_anchor
  );
  if position('prepared_input_document jsonb DEFAULT NULL::jsonb' in definition) = 0 then
    raise exception 'prepared_source_input_finalizer_parameter_rewrite_failed';
  end if;
  definition := replace(definition, finalization_anchor, prepared_block || E'\n' || finalization_anchor);
  if position('current_business_revision integer;' in definition) = 0 then
    raise exception 'prepared_source_input_finalizer_declaration_anchor_missing';
  end if;
  definition := replace(
    definition,
    'current_business_revision integer;',
    E'current_business_revision integer;\n'
      || '  retained_public_input jsonb;' || E'\n'
      || '  retained_run_document jsonb;' || E'\n'
      || '  current_business_state jsonb;' || E'\n'
      || '  current_site_intent jsonb;'
  );
  execute definition;
end
$$;

drop function public.finalize_verified_authoring(
  text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
);
revoke all on function public.finalize_verified_authoring(
  text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
) from public, anon, authenticated;
grant execute on function public.finalize_verified_authoring(
  text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
) to service_role;

commit;
