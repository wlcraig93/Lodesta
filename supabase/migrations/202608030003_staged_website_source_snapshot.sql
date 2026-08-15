-- Large replayable mirrors exceed the practical PostgREST request boundary even
-- when their database insert is set-based. Stage bounded JSON batches, then
-- materialize the immutable canonical snapshot in one database transaction.

begin;

create table public.website_source_snapshot_staging (
  snapshot_id text primary key,
  snapshot_document jsonb not null,
  expected_resource_count integer not null check (expected_resource_count >= 0),
  expected_page_count integer not null check (expected_page_count >= 0),
  created_at timestamptz not null default now(),
  check (snapshot_document->>'id' = snapshot_id),
  check ((snapshot_document->>'schemaVersion')::integer = 1),
  check (snapshot_document->>'sourceType' = 'website'),
  check (snapshot_document#>>'{payload,kind}' = 'website-mirror')
);

create table public.website_source_snapshot_staging_documents (
  snapshot_id text not null references public.website_source_snapshot_staging(snapshot_id) on delete cascade,
  document_kind text not null check (document_kind in ('resource', 'page')),
  document_id text not null,
  document jsonb not null,
  primary key (snapshot_id, document_kind, document_id),
  check (document->>'id' = document_id),
  check (document->>'sourceSnapshotId' = snapshot_id),
  check ((document->>'schemaVersion')::integer = 1)
);

create or replace function public.begin_website_source_snapshot_staging(
  snapshot_document jsonb,
  expected_resource_count integer,
  expected_page_count integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_snapshot_id text := snapshot_document->>'id';
  target_resource_count integer := expected_resource_count;
  target_page_count integer := expected_page_count;
  retained_hash text;
begin
  if (snapshot_document->>'schemaVersion')::integer is distinct from 1
    or snapshot_document->>'sourceType' is distinct from 'website'
    or snapshot_document#>>'{payload,kind}' is distinct from 'website-mirror'
    or target_resource_count is null
    or target_page_count is null
    or target_resource_count < 0
    or target_page_count < 0 then
    raise exception 'website_source_snapshot_staging_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_snapshot_id, 0));

  select content_hash into retained_hash
  from public.source_snapshots
  where id = target_snapshot_id;

  if retained_hash is not null
    and retained_hash is distinct from snapshot_document->>'contentHash' then
    raise exception 'source_snapshot_conflict';
  end if;

  -- Staging is regenerable. A fresh attempt replaces any interrupted batches for
  -- the same deterministic snapshot identity before uploading its own batches.
  delete from public.website_source_snapshot_staging
  where snapshot_id = target_snapshot_id;

  insert into public.website_source_snapshot_staging (
    snapshot_id, snapshot_document, expected_resource_count, expected_page_count
  ) values (
    target_snapshot_id, snapshot_document, target_resource_count, target_page_count
  );
end;
$$;

create or replace function public.stage_website_source_snapshot_documents(
  target_snapshot_id text,
  target_document_kind text,
  documents jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_document_kind is null
    or target_document_kind not in ('resource', 'page')
    or jsonb_typeof(documents) is distinct from 'array'
    or jsonb_array_length(documents) < 1
    or jsonb_array_length(documents) > 100 then
    raise exception 'website_source_snapshot_batch_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_snapshot_id, 0));

  if not exists (
    select 1 from public.website_source_snapshot_staging
    where snapshot_id = target_snapshot_id
  ) then
    raise exception 'website_source_snapshot_staging_missing';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(documents) as input(document)
    where (input.document->>'schemaVersion')::integer is distinct from 1
      or input.document->>'sourceSnapshotId' is distinct from target_snapshot_id
      or nullif(input.document->>'id', '') is null
  ) then
    raise exception 'website_source_snapshot_batch_scope_mismatch';
  end if;

  insert into public.website_source_snapshot_staging_documents (
    snapshot_id, document_kind, document_id, document
  )
  select target_snapshot_id, target_document_kind, input.document->>'id', input.document
  from jsonb_array_elements(documents) as input(document)
  on conflict (snapshot_id, document_kind, document_id) do nothing;

  if exists (
    select 1
    from jsonb_array_elements(documents) as input(document)
    left join public.website_source_snapshot_staging_documents retained
      on retained.snapshot_id = target_snapshot_id
     and retained.document_kind = target_document_kind
     and retained.document_id = input.document->>'id'
    where retained.document_id is null
      or retained.document is distinct from input.document
  ) then
    raise exception 'website_source_snapshot_batch_conflict';
  end if;
end;
$$;

create or replace function public.finalize_staged_website_source_snapshot(
  target_snapshot_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  staged public.website_source_snapshot_staging;
  snapshot_document jsonb;
  retained_hash text;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_snapshot_id, 0));

  select * into staged
  from public.website_source_snapshot_staging
  where snapshot_id = target_snapshot_id
  for update;

  if staged.snapshot_id is null then
    raise exception 'website_source_snapshot_staging_missing';
  end if;

  if (select count(*) from public.website_source_snapshot_staging_documents
      where snapshot_id = target_snapshot_id and document_kind = 'resource')
      <> staged.expected_resource_count
    or (select count(*) from public.website_source_snapshot_staging_documents
      where snapshot_id = target_snapshot_id and document_kind = 'page')
      <> staged.expected_page_count then
    raise exception 'website_source_snapshot_staging_incomplete';
  end if;

  snapshot_document := staged.snapshot_document;

  insert into public.source_snapshots (
    id, business_id, schema_version, source_type, source_url, content_hash, captured_at, payload
  ) values (
    target_snapshot_id,
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
  where id = target_snapshot_id;

  if retained_hash is distinct from snapshot_document->>'contentHash' then
    raise exception 'source_snapshot_conflict';
  end if;

  insert into public.source_snapshot_resources (
    id, source_snapshot_id, schema_version, capture_kind, role, requested_url, final_url,
    outcome, reason, status, content_type, stored_encoding, raw_content_hash, blob_content_hash,
    storage_key, raw_bytes, stored_bytes, headers, redirect_chain, initiator_urls, captured_at, metadata
  )
  select
    document->>'id', target_snapshot_id, 1, document->>'captureKind', document->>'role',
    document->>'requestedUrl', document->>'finalUrl', document->>'outcome', document->>'reason',
    (document->>'status')::integer, document->>'contentType', document->>'storedEncoding',
    document->>'rawContentHash', document->>'blobContentHash', document->>'storageKey',
    (document->>'rawBytes')::bigint, (document->>'storedBytes')::bigint,
    coalesce(document->'headers', '{}'::jsonb), coalesce(document->'redirectChain', '[]'::jsonb),
    coalesce(document->'initiatorUrls', '[]'::jsonb), (document->>'capturedAt')::timestamptz,
    coalesce(document->'metadata', '{}'::jsonb)
  from public.website_source_snapshot_staging_documents
  where snapshot_id = target_snapshot_id and document_kind = 'resource'
  on conflict (id) do nothing;

  if exists (
    select 1
    from public.website_source_snapshot_staging_documents input
    left join public.source_snapshot_resources retained
      on retained.id = input.document_id
    where input.snapshot_id = target_snapshot_id
      and input.document_kind = 'resource'
      and (
        retained.id is null
        or retained.source_snapshot_id <> target_snapshot_id
        or retained.outcome <> input.document->>'outcome'
        or retained.raw_content_hash is distinct from input.document->>'rawContentHash'
        or retained.blob_content_hash is distinct from input.document->>'blobContentHash'
      )
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
    document->>'id', target_snapshot_id, document->>'resourceId', document->>'renderedResourceId', 1,
    document->>'requestedUrl', document->>'finalUrl', document->>'path', document->>'outcome',
    document->>'reason', (document->>'status')::integer, document->>'contentType', document->>'canonical',
    document->>'indexability', document->'sitemap', document->>'title',
    coalesce(document->'headings', '[]'::jsonb), (document->>'wordCount')::integer,
    coalesce(document->'internalLinks', '[]'::jsonb), coalesce(document->'externalLinks', '[]'::jsonb),
    document->>'rawContentHash', document->>'exactDuplicateOf', document->>'templateSignature',
    (document->>'linkProminence')::integer, coalesce(document->>'extractedText', ''),
    document->>'textContentHash', document->>'producer', document->>'inputHash',
    (document->>'createdAt')::timestamptz
  from public.website_source_snapshot_staging_documents
  where snapshot_id = target_snapshot_id and document_kind = 'page'
  on conflict (id) do nothing;

  if exists (
    select 1
    from public.website_source_snapshot_staging_documents input
    left join public.source_snapshot_pages retained
      on retained.id = input.document_id
    where input.snapshot_id = target_snapshot_id
      and input.document_kind = 'page'
      and (
        retained.id is null
        or retained.source_snapshot_id <> target_snapshot_id
        or retained.resource_id <> input.document->>'resourceId'
        or retained.text_content_hash <> input.document->>'textContentHash'
      )
  ) then
    raise exception 'source_snapshot_page_conflict';
  end if;

  if (select count(*) from public.source_snapshot_resources where source_snapshot_id = target_snapshot_id)
      <> staged.expected_resource_count
    or (select count(*) from public.source_snapshot_pages where source_snapshot_id = target_snapshot_id)
      <> staged.expected_page_count then
    raise exception 'website_source_snapshot_manifest_incomplete';
  end if;

  delete from public.website_source_snapshot_staging
  where snapshot_id = target_snapshot_id;
end;
$$;

drop function public.save_website_source_snapshot(jsonb,jsonb,jsonb);

alter table public.website_source_snapshot_staging enable row level security;
alter table public.website_source_snapshot_staging_documents enable row level security;

revoke all on table public.website_source_snapshot_staging,
  public.website_source_snapshot_staging_documents from public, anon, authenticated;
revoke all on function public.begin_website_source_snapshot_staging(jsonb,integer,integer)
  from public, anon, authenticated;
revoke all on function public.stage_website_source_snapshot_documents(text,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.finalize_staged_website_source_snapshot(text)
  from public, anon, authenticated;

grant all on table public.website_source_snapshot_staging,
  public.website_source_snapshot_staging_documents to service_role;
grant execute on function public.begin_website_source_snapshot_staging(jsonb,integer,integer)
  to service_role;
grant execute on function public.stage_website_source_snapshot_documents(text,text,jsonb)
  to service_role;
grant execute on function public.finalize_staged_website_source_snapshot(text)
  to service_role;

commit;
