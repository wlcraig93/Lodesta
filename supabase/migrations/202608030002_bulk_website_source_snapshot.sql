-- Keep website-mirror retention atomic while replacing per-record PL/pgSQL
-- inserts and verification lookups with set-based operations.

begin;

create or replace function public.save_website_source_snapshot(
  snapshot_document jsonb,
  resource_documents jsonb,
  page_documents jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  snapshot_id text := snapshot_document->>'id';
  retained_hash text;
begin
  if (snapshot_document->>'schemaVersion')::integer <> 1
    or snapshot_document->>'sourceType' <> 'website'
    or snapshot_document#>>'{payload,kind}' <> 'website-mirror'
    or jsonb_typeof(resource_documents) <> 'array'
    or jsonb_typeof(page_documents) <> 'array' then
    raise exception 'website_source_snapshot_invalid';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(resource_documents) as input(document)
    where (document->>'schemaVersion')::integer <> 1
      or document->>'sourceSnapshotId' <> snapshot_id
  ) then
    raise exception 'source_snapshot_resource_parent_mismatch';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(page_documents) as input(document)
    where (document->>'schemaVersion')::integer <> 1
      or document->>'sourceSnapshotId' <> snapshot_id
  ) then
    raise exception 'source_snapshot_page_parent_mismatch';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(snapshot_id, 0));

  insert into public.source_snapshots (
    id, business_id, schema_version, source_type, source_url, content_hash, captured_at, payload
  ) values (
    snapshot_id,
    snapshot_document->>'businessId',
    1,
    'website',
    snapshot_document->>'sourceUrl',
    snapshot_document->>'contentHash',
    (snapshot_document->>'capturedAt')::timestamptz,
    snapshot_document->'payload'
  ) on conflict (id) do nothing;

  select content_hash into retained_hash
  from public.source_snapshots
  where id = snapshot_id;

  if retained_hash is distinct from snapshot_document->>'contentHash' then
    raise exception 'source_snapshot_conflict';
  end if;

  insert into public.source_snapshot_resources (
    id, source_snapshot_id, schema_version, capture_kind, role, requested_url, final_url,
    outcome, reason, status, content_type, stored_encoding, raw_content_hash, blob_content_hash,
    storage_key, raw_bytes, stored_bytes, headers, redirect_chain, initiator_urls, captured_at, metadata
  )
  select
    document->>'id',
    snapshot_id,
    1,
    document->>'captureKind',
    document->>'role',
    document->>'requestedUrl',
    document->>'finalUrl',
    document->>'outcome',
    document->>'reason',
    (document->>'status')::integer,
    document->>'contentType',
    document->>'storedEncoding',
    document->>'rawContentHash',
    document->>'blobContentHash',
    document->>'storageKey',
    (document->>'rawBytes')::bigint,
    (document->>'storedBytes')::bigint,
    coalesce(document->'headers', '{}'::jsonb),
    coalesce(document->'redirectChain', '[]'::jsonb),
    coalesce(document->'initiatorUrls', '[]'::jsonb),
    (document->>'capturedAt')::timestamptz,
    coalesce(document->'metadata', '{}'::jsonb)
  from jsonb_array_elements(resource_documents) as input(document)
  on conflict (id) do nothing;

  if exists (
    select 1
    from jsonb_array_elements(resource_documents) as input(document)
    left join public.source_snapshot_resources retained
      on retained.id = document->>'id'
    where retained.id is null
      or retained.source_snapshot_id <> snapshot_id
      or retained.outcome <> document->>'outcome'
      or retained.raw_content_hash is distinct from document->>'rawContentHash'
      or retained.blob_content_hash is distinct from document->>'blobContentHash'
  ) then
    raise exception 'source_snapshot_resource_conflict';
  end if;

  insert into public.source_snapshot_pages (
    id, source_snapshot_id, resource_id, rendered_resource_id, schema_version, requested_url, final_url,
    path, outcome, reason, status, content_type, canonical, indexability, sitemap, title, headings,
    word_count, internal_links, external_links, raw_content_hash, exact_duplicate_of, template_signature,
    link_prominence, extracted_text, text_content_hash, producer, input_hash, created_at
  )
  select
    document->>'id',
    snapshot_id,
    document->>'resourceId',
    document->>'renderedResourceId',
    1,
    document->>'requestedUrl',
    document->>'finalUrl',
    document->>'path',
    document->>'outcome',
    document->>'reason',
    (document->>'status')::integer,
    document->>'contentType',
    document->>'canonical',
    document->>'indexability',
    document->'sitemap',
    document->>'title',
    coalesce(document->'headings', '[]'::jsonb),
    (document->>'wordCount')::integer,
    coalesce(document->'internalLinks', '[]'::jsonb),
    coalesce(document->'externalLinks', '[]'::jsonb),
    document->>'rawContentHash',
    document->>'exactDuplicateOf',
    document->>'templateSignature',
    (document->>'linkProminence')::integer,
    coalesce(document->>'extractedText', ''),
    document->>'textContentHash',
    document->>'producer',
    document->>'inputHash',
    (document->>'createdAt')::timestamptz
  from jsonb_array_elements(page_documents) as input(document)
  on conflict (id) do nothing;

  if exists (
    select 1
    from jsonb_array_elements(page_documents) as input(document)
    left join public.source_snapshot_pages retained
      on retained.id = document->>'id'
    where retained.id is null
      or retained.source_snapshot_id <> snapshot_id
      or retained.resource_id <> document->>'resourceId'
      or retained.text_content_hash <> document->>'textContentHash'
  ) then
    raise exception 'source_snapshot_page_conflict';
  end if;

  if (select count(*) from public.source_snapshot_resources where source_snapshot_id = snapshot_id)
      <> jsonb_array_length(resource_documents)
    or (select count(*) from public.source_snapshot_pages where source_snapshot_id = snapshot_id)
      <> jsonb_array_length(page_documents) then
    raise exception 'website_source_snapshot_manifest_incomplete';
  end if;
end;
$$;

revoke all on function public.save_website_source_snapshot(jsonb,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.save_website_source_snapshot(jsonb,jsonb,jsonb)
  to service_role;

commit;
