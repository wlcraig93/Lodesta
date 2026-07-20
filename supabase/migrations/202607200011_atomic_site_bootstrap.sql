drop function if exists bootstrap_agentic_site_v1(jsonb, jsonb, jsonb, jsonb);

create or replace function bootstrap_agentic_site_v1(
  site_document jsonb,
  state_document jsonb,
  intent_document jsonb,
  form_documents jsonb,
  source_documents jsonb,
  asset_documents jsonb,
  public_input_document jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  form_document jsonb;
  source_document jsonb;
  asset_document jsonb;
  reference_id text;
begin
  if site_document ->> 'id' <> state_document ->> 'siteId'
     or site_document ->> 'businessId' <> state_document ->> 'businessId'
     or site_document ->> 'id' <> intent_document ->> 'siteId'
     or site_document ->> 'id' <> public_input_document ->> 'siteId'
     or site_document ->> 'businessId' <> public_input_document ->> 'businessId'
     or (state_document ->> 'revision')::integer <> (public_input_document ->> 'businessStateRevision')::integer
     or (intent_document ->> 'revision')::integer <> (public_input_document ->> 'siteIntentRevision')::integer then
    raise exception 'bootstrap authorities and public input must belong to the same revision';
  end if;
  if exists (select 1 from sites where id = site_document ->> 'id' or slug = site_document ->> 'slug') then
    raise exception 'site id or slug already exists';
  end if;

  insert into businesses (
    id, workspace_id, name, vertical, state_revision, state_hash, description,
    categories, vertical_module_version, vertical_classification_status,
    provenance, created_at, updated_at
  ) values (
    state_document ->> 'businessId', nullif(site_document ->> 'workspaceId', ''),
    state_document -> 'identity' ->> 'name', state_document -> 'vertical' ->> 'id',
    (state_document ->> 'revision')::integer, state_document ->> 'stateHash',
    state_document -> 'identity' ->> 'description',
    coalesce(array(select jsonb_array_elements_text(state_document -> 'identity' -> 'categories')), '{}'),
    state_document -> 'vertical' ->> 'moduleVersion', state_document -> 'vertical' ->> 'status',
    '{}'::jsonb, (site_document ->> 'createdAt')::timestamptz,
    (state_document ->> 'updatedAt')::timestamptz
  );
  insert into sites (
    id, workspace_id, business_id, slug, status, is_primary, created_at, updated_at
  ) values (
    site_document ->> 'id', nullif(site_document ->> 'workspaceId', ''), site_document ->> 'businessId',
    site_document ->> 'slug', site_document ->> 'status', true,
    (site_document ->> 'createdAt')::timestamptz, (site_document ->> 'updatedAt')::timestamptz
  );
  insert into business_states_v2 (
    business_id, site_id, schema_version, revision, state_hash, state, updated_at
  ) values (
    state_document ->> 'businessId', state_document ->> 'siteId', state_document ->> 'schemaVersion',
    (state_document ->> 'revision')::integer, state_document ->> 'stateHash', state_document,
    (state_document ->> 'updatedAt')::timestamptz
  );
  insert into site_intents_v2 (
    id, site_id, schema_version, revision, intent_hash, intent, created_at, updated_at
  ) values (
    intent_document ->> 'id', intent_document ->> 'siteId', intent_document ->> 'schemaVersion',
    (intent_document ->> 'revision')::integer, intent_document ->> 'intentHash', intent_document,
    (intent_document ->> 'updatedAt')::timestamptz, (intent_document ->> 'updatedAt')::timestamptz
  );

  for form_document in select * from jsonb_array_elements(form_documents) loop
    if form_document ->> 'siteId' <> site_document ->> 'id' then raise exception 'form belongs to another site'; end if;
    insert into form_definitions_v2 (
      id, site_id, schema_version, revision, status, definition, created_at
    ) values (
      form_document ->> 'id', form_document ->> 'siteId', form_document ->> 'schemaVersion',
      (form_document ->> 'revision')::integer, form_document ->> 'status', form_document,
      (form_document ->> 'createdAt')::timestamptz
    );
  end loop;

  for source_document in select * from jsonb_array_elements(source_documents) loop
    if source_document ->> 'businessId' <> site_document ->> 'businessId' then raise exception 'source snapshot belongs to another business'; end if;
    insert into source_snapshots (
      id, business_id, source_type, source_url, content_hash, captured_at, payload
    ) values (
      source_document ->> 'id', source_document ->> 'businessId', source_document ->> 'sourceType',
      source_document ->> 'sourceUrl', source_document ->> 'contentHash',
      (source_document ->> 'capturedAt')::timestamptz, source_document -> 'payload'
    );
  end loop;

  for asset_document in select * from jsonb_array_elements(asset_documents) loop
    if asset_document ->> 'businessId' <> site_document ->> 'businessId' then raise exception 'asset revision belongs to another business'; end if;
    insert into asset_revisions (
      id, asset_id, business_id, schema_version, content_hash, storage_path, public_url,
      mime_type, bytes, width, height, provenance, rights_status, attestation, created_at
    ) values (
      asset_document ->> 'id', asset_document ->> 'assetId', asset_document ->> 'businessId',
      asset_document ->> 'schemaVersion', asset_document ->> 'contentHash', asset_document ->> 'storageKey',
      asset_document ->> 'publicUrl', asset_document ->> 'mimeType', (asset_document ->> 'bytes')::integer,
      (asset_document ->> 'width')::integer, (asset_document ->> 'height')::integer,
      asset_document -> 'provenance', asset_document ->> 'rightsStatus', asset_document -> 'attestation',
      (asset_document ->> 'createdAt')::timestamptz
    );
  end loop;

  insert into site_public_build_inputs (
    id, site_id, business_id, schema_version, business_state_revision, site_intent_revision,
    vertical_module_id, vertical_module_version, input_hash, input, created_at
  ) values (
    public_input_document ->> 'id', public_input_document ->> 'siteId', public_input_document ->> 'businessId',
    public_input_document ->> 'schemaVersion', (public_input_document ->> 'businessStateRevision')::integer,
    (public_input_document ->> 'siteIntentRevision')::integer,
    public_input_document -> 'verticalModule' ->> 'id', public_input_document -> 'verticalModule' ->> 'version',
    public_input_document ->> 'inputHash', public_input_document,
    (public_input_document ->> 'createdAt')::timestamptz
  );

  for reference_id in select jsonb_array_elements_text(public_input_document -> 'sourceSnapshotIds') loop
    if not exists (select 1 from source_snapshots where id = reference_id and business_id = site_document ->> 'businessId') then
      raise exception 'public input references an unavailable source snapshot';
    end if;
    insert into site_public_build_input_sources(input_id, source_snapshot_id)
    values (public_input_document ->> 'id', reference_id);
  end loop;
  for reference_id in select jsonb_array_elements_text(public_input_document -> 'assetRevisionIds') loop
    if not exists (select 1 from asset_revisions where id = reference_id and business_id = site_document ->> 'businessId') then
      raise exception 'public input references an unavailable asset revision';
    end if;
    insert into site_public_build_input_assets(input_id, asset_revision_id)
    values (public_input_document ->> 'id', reference_id);
  end loop;
  for reference_id in select value ->> 'id' from jsonb_array_elements(public_input_document -> 'forms') value loop
    if not exists (select 1 from form_definitions_v2 where id = reference_id and site_id = site_document ->> 'id') then
      raise exception 'public input references an unavailable form definition';
    end if;
    insert into site_public_build_input_forms(input_id, form_definition_id)
    values (public_input_document ->> 'id', reference_id);
  end loop;

  update sites
  set current_public_build_input_id = public_input_document ->> 'id',
      updated_at = (public_input_document ->> 'createdAt')::timestamptz
  where id = site_document ->> 'id';

  return jsonb_build_object('ok', true, 'siteId', site_document ->> 'id', 'publicBuildInputId', public_input_document ->> 'id');
end;
$$;

revoke all on function bootstrap_agentic_site_v1(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function bootstrap_agentic_site_v1(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
