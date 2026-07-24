-- Refresh authority functions that were already deployed before the clean-cut
-- media-origin and preview-grant migrations changed their referenced schema.

begin;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'asset_revisions'
      and column_name = 'origin'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'asset_revisions'
      and column_name = 'provenance'
  ) then
    raise exception 'canonical_authority_refresh_requires_media_origin_columns';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'asset_revisions'
      and column_name in ('rights_status', 'attestation')
  ) then
    raise exception 'canonical_authority_refresh_rejects_retired_media_rights_columns';
  end if;

  if to_regclass('public.preview_grants') is null
    or to_regclass('public.preview_tokens') is not null then
    raise exception 'canonical_authority_refresh_requires_preview_grants_cutover';
  end if;
end
$$;

create or replace function public.bootstrap_site(
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
declare item jsonb;
begin
  insert into businesses (
    id, name, vertical, created_at, updated_at
  ) values (
    state_document->>'businessId', state_document#>>'{identity,name}',
    coalesce(public_input_document#>>'{domainContext,id}', 'general_local'),
    (site_document->>'createdAt')::timestamptz, (site_document->>'updatedAt')::timestamptz
  );
  insert into sites (
    id, owner_user_id, business_id, slug, source_url, normalized_source, status, created_at, updated_at
  ) values (
    site_document->>'id', nullif(site_document->>'ownerUserId', '')::uuid,
    site_document->>'businessId', site_document->>'slug', site_document->>'sourceUrl',
    site_document->>'normalizedSource', site_document->>'status',
    (site_document->>'createdAt')::timestamptz, (site_document->>'updatedAt')::timestamptz
  );
  insert into business_states values (
    state_document->>'businessId', state_document->>'siteId', (state_document->>'schemaVersion')::integer,
    (state_document->>'revision')::integer, state_document->>'stateHash', state_document,
    (state_document->>'updatedAt')::timestamptz
  );
  insert into site_intents (
    id, site_id, schema_version, revision, intent_hash, intent, created_at, updated_at
  ) values (
    intent_document->>'id', intent_document->>'siteId', (intent_document->>'schemaVersion')::integer,
    (intent_document->>'revision')::integer, intent_document->>'intentHash', intent_document,
    (intent_document->>'updatedAt')::timestamptz, (intent_document->>'updatedAt')::timestamptz
  );
  for item in select * from jsonb_array_elements(form_documents) loop
    insert into form_definitions values (
      item->>'id', item->>'siteId', (item->>'schemaVersion')::integer, (item->>'revision')::integer,
      item->>'status', item, (item->>'createdAt')::timestamptz
    );
  end loop;
  for item in select * from jsonb_array_elements(source_documents) loop
    insert into source_snapshots (
      id, business_id, schema_version, source_type, source_url, content_hash, captured_at, payload
    ) values (
      item->>'id', item->>'businessId', (item->>'schemaVersion')::integer, item->>'sourceType', item->>'sourceUrl',
      item->>'contentHash', (item->>'capturedAt')::timestamptz, item->'payload'
    );
  end loop;
  for item in select * from jsonb_array_elements(asset_documents) loop
    insert into asset_revisions (
      id, asset_id, business_id, schema_version, content_hash, storage_path, public_url,
      mime_type, bytes, width, height, origin, provenance, created_at
    ) values (
      item->>'id', item->>'assetId', item->>'businessId', (item->>'schemaVersion')::integer,
      item->>'contentHash', item->>'storageKey', item->>'publicUrl', item->>'mimeType',
      (item->>'bytes')::integer, (item->>'width')::integer, (item->>'height')::integer,
      item->>'origin', item->'provenance', (item->>'createdAt')::timestamptz
    );
  end loop;
  insert into site_public_build_inputs (
    id, site_id, business_id, schema_version, business_state_revision, site_intent_revision,
    domain_context_id, domain_context_version, input_hash, input, created_at
  ) values (
    public_input_document->>'id', public_input_document->>'siteId', public_input_document->>'businessId',
    (public_input_document->>'schemaVersion')::integer,
    (public_input_document->>'businessStateRevision')::integer,
    (public_input_document->>'siteIntentRevision')::integer,
    public_input_document#>>'{domainContext,id}', public_input_document#>>'{domainContext,version}',
    public_input_document->>'inputHash', public_input_document,
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
  update sites set current_public_build_input_id = public_input_document->>'id'
    where id = site_document->>'id';
  return jsonb_build_object('siteId', site_document->>'id');
end;
$$;

create or replace function public.dispose_owned_site(target_site_id text, target_owner_user_id uuid)
returns setof sites
language plpgsql
security definer
set search_path = public
as $$
declare
  disposed_at timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtextextended(target_owner_user_id::text, 0));
  perform 1
    from sites
    where id = target_site_id and owner_user_id = target_owner_user_id
    for update;
  if not found then return; end if;

  update site_agent_run_events
    set status = 'cancelled', completed_at = disposed_at
    where status = 'running'
      and run_id in (
        select id from site_agent_runs
        where site_id = target_site_id and status in ('queued', 'running', 'needs_input')
      );

  update site_agent_runs
    set
      status = 'cancelled',
      completed_at = disposed_at,
      run = jsonb_set(
        jsonb_set(run, '{status}', to_jsonb('cancelled'::text), true),
        '{completedAt}',
        to_jsonb(to_char(disposed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
        true
      )
    where site_id = target_site_id and status in ('queued', 'running', 'needs_input');

  update site_agent_sessions
    set lease_expires_at = disposed_at, rotate_at = disposed_at, updated_at = disposed_at
    where site_id = target_site_id and status in ('active', 'checkpointed', 'rotating');

  update website_setups
    set status = 'canceled', locked_by = null, locked_at = null, updated_at = disposed_at
    where site_id = target_site_id
      and owner_user_id = target_owner_user_id
      and status <> 'canceled';

  update preview_grants
    set revoked_at = coalesce(revoked_at, disposed_at)
    where site_id = target_site_id;
  delete from active_domains where site_id = target_site_id;
  update domains
    set status = 'expired', routing_status = 'pending', updated_at = disposed_at
    where site_id = target_site_id and status <> 'expired';

  return query
    update sites
      set status = 'paused', owner_user_id = null, updated_at = disposed_at
      where id = target_site_id and owner_user_id = target_owner_user_id
      returning *;
end;
$$;

revoke all on function public.bootstrap_site(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.bootstrap_site(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)
  to service_role;

revoke all on function public.dispose_owned_site(text,uuid)
  from public, anon, authenticated;
grant execute on function public.dispose_owned_site(text,uuid)
  to service_role;

drop function if exists public.commit_verified_site_build(jsonb,jsonb);

do $$
declare
  bootstrap_definition text;
  disposition_definition text;
begin
  bootstrap_definition := pg_get_functiondef(
    'public.bootstrap_site(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  );
  disposition_definition := pg_get_functiondef(
    'public.dispose_owned_site(text,uuid)'::regprocedure
  );

  if bootstrap_definition ilike '%rights_status%'
    or bootstrap_definition ilike '%rightsStatus%'
    or bootstrap_definition ilike '%attestation%'
    or bootstrap_definition not ilike '%origin, provenance%'
    or bootstrap_definition not ilike '%item->>''origin''%'
    or bootstrap_definition not ilike '%item->''provenance''%' then
    raise exception 'canonical_bootstrap_site_postcondition_failed';
  end if;

  if disposition_definition ilike '%preview_tokens%'
    or disposition_definition not ilike '%update preview_grants%' then
    raise exception 'canonical_dispose_owned_site_postcondition_failed';
  end if;

  if to_regprocedure('public.commit_verified_site_build(jsonb,jsonb)') is not null then
    raise exception 'retired_commit_verified_site_build_remains';
  end if;
end
$$;

commit;
