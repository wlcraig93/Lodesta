-- A website recapture may advance the system-discovered canonical source logo
-- without changing owner authority. Source snapshots and prior asset revisions
-- remain immutable; only current BusinessState and the new public input advance.

drop function if exists public.apply_prepared_source_recapture(text, jsonb);

create or replace function public.apply_prepared_source_recapture(
  target_expected_public_input_id text,
  asset_documents jsonb,
  state_document jsonb,
  public_input_document jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_site public.sites;
  target_state public.business_states;
  target_intent public.site_intents;
  retained_hash text;
  source_id text;
  asset_id text;
  form_id text;
  item jsonb;
  recaptured_at timestamptz := (public_input_document->>'createdAt')::timestamptz;
begin
  select * into target_site from public.sites where id = public_input_document->>'siteId' for update;
  if target_site.id is null or target_site.current_public_build_input_id <> target_expected_public_input_id then return false; end if;
  if exists (
    select 1 from public.site_agent_runs
    where site_id = target_site.id and status in ('queued', 'running', 'needs_input')
  ) or exists (
    select 1 from public.site_agent_sessions
    where site_id = target_site.id and sandbox_id is not null
  ) then return false; end if;

  select * into target_state from public.business_states where site_id = target_site.id for update;
  select * into target_intent from public.site_intents where site_id = target_site.id;
  if target_state.business_id is null
    or target_intent.id is null
    or state_document->>'businessId' <> target_site.business_id
    or state_document->>'siteId' <> target_site.id
    or (state_document->>'ownerOperationalRevision')::integer <> (target_state.state->>'ownerOperationalRevision')::integer
    or (state_document->>'revision')::integer not in (target_state.revision, target_state.revision + 1)
    or public_input_document->>'businessId' <> target_site.business_id
    or (public_input_document->>'ownerOperationalRevision')::integer <> (state_document->>'ownerOperationalRevision')::integer
    or (public_input_document->>'ownerIntentRevision')::integer <> (target_intent.intent->>'ownerIntentRevision')::integer
    or jsonb_array_length(public_input_document->'sourceSnapshotIds') = 0 then
    return false;
  end if;

  for item in select value from jsonb_array_elements(coalesce(asset_documents, '[]'::jsonb)) loop
    if item->>'businessId' <> target_site.business_id then raise exception 'source_recapture_asset_scope_mismatch'; end if;
    insert into public.asset_revisions (
      id, asset_id, business_id, schema_version, content_hash, storage_path,
      public_url, mime_type, bytes, width, height, origin, provenance, created_at
    ) values (
      item->>'id', item->>'assetId', item->>'businessId', (item->>'schemaVersion')::integer,
      item->>'contentHash', item->>'storageKey', item->>'publicUrl', item->>'mimeType',
      (item->>'bytes')::integer, (item->>'width')::integer, (item->>'height')::integer,
      item->>'origin', item->'provenance', (item->>'createdAt')::timestamptz
    ) on conflict (id) do nothing;
    if not exists (
      select 1 from public.asset_revisions
      where id = item->>'id' and content_hash = item->>'contentHash' and business_id = target_site.business_id
    ) then raise exception 'source_recapture_asset_conflict'; end if;
  end loop;

  if state_document->>'stateHash' is distinct from target_state.state_hash then
    update public.business_states set
      schema_version = (state_document->>'schemaVersion')::integer,
      revision = (state_document->>'revision')::integer,
      state_hash = state_document->>'stateHash',
      state = state_document,
      updated_at = (state_document->>'updatedAt')::timestamptz
    where business_id = target_site.business_id;
  end if;

  insert into public.site_public_build_inputs (
    id, site_id, business_id, schema_version, owner_operational_revision,
    owner_intent_revision, input_hash, input, created_at
  ) values (
    public_input_document->>'id', target_site.id, target_site.business_id, 1,
    (public_input_document->>'ownerOperationalRevision')::integer,
    (public_input_document->>'ownerIntentRevision')::integer,
    public_input_document->>'inputHash', public_input_document, recaptured_at
  ) on conflict (id) do nothing;

  select input_hash into retained_hash from public.site_public_build_inputs where id = public_input_document->>'id';
  if retained_hash is distinct from public_input_document->>'inputHash' then raise exception 'public_build_input_conflict'; end if;

  for source_id in select jsonb_array_elements_text(public_input_document->'sourceSnapshotIds') loop
    insert into public.site_public_build_input_sources(input_id, source_snapshot_id)
    values (public_input_document->>'id', source_id) on conflict do nothing;
  end loop;
  for asset_id in select jsonb_array_elements_text(public_input_document->'assetRevisionIds') loop
    insert into public.site_public_build_input_assets(input_id, asset_revision_id)
    values (public_input_document->>'id', asset_id) on conflict do nothing;
  end loop;
  for form_id in select value->>'id' from jsonb_array_elements(public_input_document->'forms') loop
    insert into public.site_public_build_input_forms(input_id, form_definition_id)
    values (public_input_document->>'id', form_id) on conflict do nothing;
  end loop;

  if (select count(*) from public.site_public_build_input_sources where input_id = public_input_document->>'id')
      <> jsonb_array_length(public_input_document->'sourceSnapshotIds')
    or (select count(*) from public.site_public_build_input_assets where input_id = public_input_document->>'id')
      <> jsonb_array_length(public_input_document->'assetRevisionIds')
    or (select count(*) from public.site_public_build_input_forms where input_id = public_input_document->>'id')
      <> jsonb_array_length(public_input_document->'forms') then
    raise exception 'public_build_input_reference_mismatch';
  end if;

  update public.site_versions
  set status = 'stale', stale_reason = 'managed_dependency_changed',
      version = jsonb_set(jsonb_set(version, '{status}', '"stale"'::jsonb), '{staleReason}', '"managed_dependency_changed"'::jsonb)
  where site_id = target_site.id and status = 'candidate';

  update public.site_agent_sessions
  set status = 'closed', lease_expires_at = recaptured_at, updated_at = recaptured_at
  where site_id = target_site.id and sandbox_id is null and status not in ('closed', 'failed');

  update public.sites
  set current_public_build_input_id = public_input_document->>'id', updated_at = recaptured_at
  where id = target_site.id;
  return true;
end;
$$;

revoke all on function public.apply_prepared_source_recapture(text,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.apply_prepared_source_recapture(text,jsonb,jsonb,jsonb) to service_role;
