-- Replace derived crawl objects/chunks with one immutable, replayable website mirror.
-- Pre-launch hard cutover: run the reviewed site-authoring reset before applying.

begin;

do $$
begin
  if exists (select 1 from public.source_snapshot_objects limit 1)
    or exists (select 1 from public.source_snapshot_chunks limit 1) then
    raise exception 'replayable_source_mirror_requires_reviewed_prelaunch_reset';
  end if;
end;
$$;

drop function if exists public.search_source_snapshot_chunks(text,text[],jsonb,integer,extensions.vector);
drop table public.source_snapshot_chunks;
drop table public.source_snapshot_objects;
drop extension if exists vector;

-- Redirect sources are legacy public URLs, not newly authored route slugs. Preserve
-- their case and common safe filename characters while keeping destinations bound
-- to the existing lowercase live-route contract.
do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
      from pg_constraint
      where conrelid = 'public.site_version_redirects'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) like '%source_path ~%'
  loop
    execute format('alter table public.site_version_redirects drop constraint %I', constraint_record.conname);
  end loop;
end $$;

alter table public.site_version_redirects
  add constraint site_version_redirects_source_path_safe_check
  check (
    source_path ~ '^/(?:[A-Za-z0-9._~!$&''()*+,;=:@-]|%[0-9A-Fa-f]{2})+(?:/(?:[A-Za-z0-9._~!$&''()*+,;=:@-]|%[0-9A-Fa-f]{2})+)*$'
    and source_path !~* '%(?:2f|5c|2e)'
    and source_path !~ '(^|/)\\.{1,2}(/|$)'
  );

create table public.source_snapshot_resources (
  id text primary key,
  source_snapshot_id text not null references public.source_snapshots(id) on delete restrict,
  schema_version integer not null check (schema_version = 1),
  capture_kind text not null check (capture_kind in ('http_response', 'rendered_dom')),
  role text not null check (role in ('robots', 'sitemap', 'document', 'rendered_document', 'stylesheet', 'script', 'image', 'font', 'data', 'other')),
  requested_url text not null,
  final_url text,
  outcome text not null check (outcome in ('fetched', 'excluded', 'failed', 'unfinished')),
  reason text,
  status integer check (status between 100 and 599),
  content_type text,
  stored_encoding text check (stored_encoding in ('identity', 'gzip')),
  raw_content_hash text,
  blob_content_hash text,
  storage_key text,
  raw_bytes bigint not null check (raw_bytes >= 0),
  stored_bytes bigint not null check (stored_bytes >= 0),
  headers jsonb not null default '{}'::jsonb,
  redirect_chain jsonb not null default '[]'::jsonb,
  initiator_urls jsonb not null default '[]'::jsonb,
  captured_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  unique (source_snapshot_id, id),
  check (jsonb_typeof(headers) = 'object'),
  check (jsonb_typeof(redirect_chain) = 'array'),
  check (jsonb_typeof(initiator_urls) = 'array'),
  check (
    (stored_encoding is null and raw_content_hash is null and blob_content_hash is null and storage_key is null)
    or
    (stored_encoding is not null and raw_content_hash is not null and blob_content_hash is not null and storage_key is not null)
  ),
  check (outcome not in ('excluded', 'unfinished') or (stored_encoding is null and raw_bytes = 0 and stored_bytes = 0)),
  check (outcome <> 'fetched' or (final_url is not null and status is not null and content_type is not null and stored_encoding is not null))
);

create index source_snapshot_resources_snapshot_id_idx
  on public.source_snapshot_resources(source_snapshot_id, id);
create index source_snapshot_resources_snapshot_role_url_idx
  on public.source_snapshot_resources(source_snapshot_id, role, requested_url);
create index source_snapshot_resources_blob_idx
  on public.source_snapshot_resources(blob_content_hash, storage_key)
  where blob_content_hash is not null;

create table public.source_snapshot_pages (
  id text primary key,
  source_snapshot_id text not null references public.source_snapshots(id) on delete cascade,
  resource_id text not null,
  rendered_resource_id text,
  schema_version integer not null check (schema_version = 1),
  requested_url text not null,
  final_url text,
  path text not null,
  outcome text not null check (outcome in ('fetched', 'excluded', 'failed', 'unfinished')),
  reason text,
  status integer check (status between 100 and 599),
  content_type text,
  canonical text,
  indexability text not null check (indexability in ('indexable', 'noindex', 'unknown')),
  sitemap jsonb,
  title text,
  headings jsonb not null default '[]'::jsonb,
  word_count integer not null check (word_count >= 0),
  internal_links jsonb not null default '[]'::jsonb,
  external_links jsonb not null default '[]'::jsonb,
  raw_content_hash text,
  exact_duplicate_of text,
  template_signature text,
  link_prominence integer not null check (link_prominence >= 0),
  extracted_text text not null,
  text_content_hash text not null,
  search_document tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', left(extracted_text, 500000)), 'B')
  ) stored,
  producer text not null,
  input_hash text not null,
  created_at timestamptz not null,
  foreign key (source_snapshot_id, resource_id)
    references public.source_snapshot_resources(source_snapshot_id, id) on delete restrict,
  foreign key (source_snapshot_id, rendered_resource_id)
    references public.source_snapshot_resources(source_snapshot_id, id) on delete restrict,
  check (left(path, 1) = '/'),
  check (sitemap is null or jsonb_typeof(sitemap) = 'object'),
  check (jsonb_typeof(headings) = 'array'),
  check (jsonb_typeof(internal_links) = 'array'),
  check (jsonb_typeof(external_links) = 'array')
);

create index source_snapshot_pages_snapshot_id_idx
  on public.source_snapshot_pages(source_snapshot_id, id);
create index source_snapshot_pages_snapshot_path_idx
  on public.source_snapshot_pages(source_snapshot_id, path, id);
create index source_snapshot_pages_resource_id_idx
  on public.source_snapshot_pages(source_snapshot_id, resource_id);
create index source_snapshot_pages_rendered_resource_id_idx
  on public.source_snapshot_pages(source_snapshot_id, rendered_resource_id)
  where rendered_resource_id is not null;
create index source_snapshot_pages_search_idx
  on public.source_snapshot_pages using gin(search_document);

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
  resource_document jsonb;
  page_document jsonb;
  retained_hash text;
begin
  if (snapshot_document->>'schemaVersion')::integer <> 1
    or snapshot_document->>'sourceType' <> 'website'
    or snapshot_document#>>'{payload,kind}' <> 'website-mirror'
    or jsonb_typeof(resource_documents) <> 'array'
    or jsonb_typeof(page_documents) <> 'array' then
    raise exception 'website_source_snapshot_invalid';
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

  select content_hash into retained_hash from public.source_snapshots where id = snapshot_id;
  if retained_hash is distinct from snapshot_document->>'contentHash' then
    raise exception 'source_snapshot_conflict';
  end if;

  for resource_document in select value from jsonb_array_elements(resource_documents) loop
    if (resource_document->>'schemaVersion')::integer <> 1
      or resource_document->>'sourceSnapshotId' <> snapshot_id then
      raise exception 'source_snapshot_resource_parent_mismatch';
    end if;
    insert into public.source_snapshot_resources (
      id, source_snapshot_id, schema_version, capture_kind, role, requested_url, final_url,
      outcome, reason, status, content_type, stored_encoding, raw_content_hash, blob_content_hash,
      storage_key, raw_bytes, stored_bytes, headers, redirect_chain, initiator_urls, captured_at, metadata
    ) values (
      resource_document->>'id', snapshot_id, 1, resource_document->>'captureKind', resource_document->>'role',
      resource_document->>'requestedUrl', resource_document->>'finalUrl', resource_document->>'outcome',
      resource_document->>'reason', (resource_document->>'status')::integer, resource_document->>'contentType',
      resource_document->>'storedEncoding', resource_document->>'rawContentHash', resource_document->>'blobContentHash',
      resource_document->>'storageKey', (resource_document->>'rawBytes')::bigint,
      (resource_document->>'storedBytes')::bigint, coalesce(resource_document->'headers', '{}'::jsonb),
      coalesce(resource_document->'redirectChain', '[]'::jsonb), coalesce(resource_document->'initiatorUrls', '[]'::jsonb),
      (resource_document->>'capturedAt')::timestamptz, coalesce(resource_document->'metadata', '{}'::jsonb)
    ) on conflict (id) do nothing;
    if not exists (
      select 1 from public.source_snapshot_resources retained
      where retained.id = resource_document->>'id'
        and retained.source_snapshot_id = snapshot_id
        and retained.outcome = resource_document->>'outcome'
        and retained.raw_content_hash is not distinct from resource_document->>'rawContentHash'
        and retained.blob_content_hash is not distinct from resource_document->>'blobContentHash'
    ) then
      raise exception 'source_snapshot_resource_conflict';
    end if;
  end loop;

  for page_document in select value from jsonb_array_elements(page_documents) loop
    if (page_document->>'schemaVersion')::integer <> 1
      or page_document->>'sourceSnapshotId' <> snapshot_id then
      raise exception 'source_snapshot_page_parent_mismatch';
    end if;
    insert into public.source_snapshot_pages (
      id, source_snapshot_id, resource_id, rendered_resource_id, schema_version, requested_url, final_url,
      path, outcome, reason, status, content_type, canonical, indexability, sitemap, title, headings,
      word_count, internal_links, external_links, raw_content_hash, exact_duplicate_of, template_signature,
      link_prominence, extracted_text, text_content_hash, producer, input_hash, created_at
    ) values (
      page_document->>'id', snapshot_id, page_document->>'resourceId', page_document->>'renderedResourceId', 1,
      page_document->>'requestedUrl', page_document->>'finalUrl', page_document->>'path', page_document->>'outcome',
      page_document->>'reason', (page_document->>'status')::integer, page_document->>'contentType',
      page_document->>'canonical', page_document->>'indexability', page_document->'sitemap', page_document->>'title',
      coalesce(page_document->'headings', '[]'::jsonb), (page_document->>'wordCount')::integer,
      coalesce(page_document->'internalLinks', '[]'::jsonb), coalesce(page_document->'externalLinks', '[]'::jsonb),
      page_document->>'rawContentHash', page_document->>'exactDuplicateOf', page_document->>'templateSignature',
      (page_document->>'linkProminence')::integer, coalesce(page_document->>'extractedText', ''),
      page_document->>'textContentHash', page_document->>'producer', page_document->>'inputHash',
      (page_document->>'createdAt')::timestamptz
    ) on conflict (id) do nothing;
    if not exists (
      select 1 from public.source_snapshot_pages retained
      where retained.id = page_document->>'id'
        and retained.source_snapshot_id = snapshot_id
        and retained.resource_id = page_document->>'resourceId'
        and retained.text_content_hash = page_document->>'textContentHash'
    ) then
      raise exception 'source_snapshot_page_conflict';
    end if;
  end loop;

  if (select count(*) from public.source_snapshot_resources where source_snapshot_id = snapshot_id)
      <> jsonb_array_length(resource_documents)
    or (select count(*) from public.source_snapshot_pages where source_snapshot_id = snapshot_id)
      <> jsonb_array_length(page_documents) then
    raise exception 'website_source_snapshot_manifest_incomplete';
  end if;
end;
$$;

create or replace function public.search_source_snapshot_pages(
  search_query text,
  source_ids text[],
  filters jsonb default '{}'::jsonb,
  max_results integer default 20
)
returns table (
  source_snapshot_id text,
  page_id text,
  url text,
  path text,
  title text,
  score double precision,
  excerpt text,
  content_hash text
)
language sql
stable
security definer
set search_path = public
as $$
  with query as (
    select websearch_to_tsquery('english', search_query) value
  )
  select
    page.source_snapshot_id,
    page.id as page_id,
    coalesce(page.final_url, page.requested_url) as url,
    page.path,
    page.title,
    ts_rank_cd(page.search_document, query.value)::double precision as score,
    ts_headline('english', page.extracted_text, query.value, 'MaxFragments=3,MaxWords=45,MinWords=15') as excerpt,
    page.text_content_hash as content_hash
  from public.source_snapshot_pages page
  cross join query
  where (coalesce(cardinality(source_ids), 0) = 0 or page.source_snapshot_id = any(source_ids))
    and page.search_document @@ query.value
    and (
      jsonb_array_length(coalesce(filters->'paths', '[]'::jsonb)) = 0
      or exists (
        select 1 from jsonb_array_elements_text(filters->'paths') prefix
        where page.path like prefix || '%'
      )
    )
    and (
      jsonb_array_length(coalesce(filters->'statuses', '[]'::jsonb)) = 0
      or page.status in (select value::integer from jsonb_array_elements_text(filters->'statuses'))
    )
    and (
      jsonb_array_length(coalesce(filters->'indexability', '[]'::jsonb)) = 0
      or page.indexability in (select value from jsonb_array_elements_text(filters->'indexability'))
    )
    and (coalesce((filters->>'sitemapOnly')::boolean, false) = false or page.sitemap is not null)
  order by score desc, page.id
  limit greatest(1, least(max_results, 50));
$$;

create or replace function public.apply_prepared_source_recapture(
  target_expected_public_input_id text,
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

  select * into target_state from public.business_states where site_id = target_site.id;
  select * into target_intent from public.site_intents where site_id = target_site.id;
  if target_state.business_id is null
    or target_intent.id is null
    or public_input_document->>'businessId' <> target_site.business_id
    or (public_input_document->>'ownerOperationalRevision')::integer <> (target_state.state->>'ownerOperationalRevision')::integer
    or (public_input_document->>'ownerIntentRevision')::integer <> (target_intent.intent->>'ownerIntentRevision')::integer
    or jsonb_array_length(public_input_document->'sourceSnapshotIds') = 0 then
    return false;
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
  set status = 'stale',
      stale_reason = 'managed_dependency_changed',
      version = jsonb_set(jsonb_set(version, '{status}', '"stale"'::jsonb), '{staleReason}', '"managed_dependency_changed"'::jsonb)
  where site_id = target_site.id and status = 'candidate';

  update public.site_agent_sessions
  set status = 'closed', lease_expires_at = recaptured_at, updated_at = recaptured_at
  where site_id = target_site.id
    and sandbox_id is null
    and status not in ('closed', 'failed');

  update public.sites
  set current_public_build_input_id = public_input_document->>'id', updated_at = recaptured_at
  where id = target_site.id;
  return true;
end;
$$;

create or replace function public.validate_site_version_redirects_before_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  live_routes text[];
begin
  if new.status <> 'published' or old.status = 'published' then return new; end if;

  select array_agg(route->>'path') into live_routes
  from public.site_build_artifacts artifact,
       jsonb_array_elements(artifact.artifact->'routes') route
  where artifact.id = new.artifact_id;

  if live_routes is null then raise exception 'candidate_redirect_routes_missing'; end if;

  if exists (
    select 1
    from public.site_version_sources source_reference
    join public.source_snapshots snapshot on snapshot.id = source_reference.source_snapshot_id
    where source_reference.version_id = new.id
      and snapshot.payload->>'kind' = 'website-mirror'
  ) and not exists (
    select 1 from public.site_version_source_coverage coverage where coverage.version_id = new.id
  ) then raise exception 'candidate_source_coverage_missing'; end if;

  if exists (
    select 1
    from public.site_version_source_coverage coverage,
         jsonb_array_elements(coverage.report->'entries') entry
    where coverage.version_id = new.id
      and entry->>'disposition' = 'redirected'
      and not exists (
        select 1 from public.site_version_redirects redirect
        where redirect.version_id = new.id
          and redirect.source_path = entry->>'sourcePath'
          and redirect.destination_path = entry->>'destinationPath'
      )
  ) or exists (
    select 1 from public.site_version_redirects redirect
    where redirect.version_id = new.id
      and not exists (
        select 1
        from public.site_version_source_coverage coverage,
             jsonb_array_elements(coverage.report->'entries') entry
        where coverage.version_id = new.id
          and entry->>'disposition' = 'redirected'
          and entry->>'sourcePath' = redirect.source_path
          and entry->>'destinationPath' = redirect.destination_path
      )
  ) then raise exception 'candidate_redirect_coverage_mismatch'; end if;

  if exists (
    select 1 from public.site_version_redirects redirect
    where redirect.version_id = new.id
      and (redirect.source_path = any(live_routes) or not redirect.destination_path = any(live_routes))
  ) then raise exception 'candidate_redirect_conflict_or_stranded'; end if;

  if exists (
    select 1
    from public.site_version_redirects source_redirect
    join public.site_version_redirects destination_redirect
      on destination_redirect.version_id = source_redirect.version_id
     and destination_redirect.source_path = source_redirect.destination_path
    where source_redirect.version_id = new.id
  ) then raise exception 'candidate_redirect_chain_or_cycle'; end if;

  if exists (
    select 1 from public.site_redirects owner_redirect
    where owner_redirect.site_id = new.site_id
      and owner_redirect.status = 'active'
      and (
        owner_redirect.source_path = any(live_routes)
        or not owner_redirect.destination_path = any(live_routes)
        or exists (
          select 1 from public.site_version_redirects candidate_redirect
          where candidate_redirect.version_id = new.id
            and candidate_redirect.source_path = owner_redirect.source_path
            and candidate_redirect.destination_path <> owner_redirect.destination_path
        )
      )
  ) then raise exception 'owner_redirect_conflict_or_stranded'; end if;

  return new;
end;
$$;

alter table public.source_snapshot_resources enable row level security;
alter table public.source_snapshot_pages enable row level security;

revoke all on table public.source_snapshot_resources, public.source_snapshot_pages from anon, authenticated;
revoke all on function public.save_website_source_snapshot(jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.search_source_snapshot_pages(text,text[],jsonb,integer) from public, anon, authenticated;
revoke all on function public.apply_prepared_source_recapture(text,jsonb) from public, anon, authenticated;

grant all on table public.source_snapshot_resources, public.source_snapshot_pages to service_role;
grant execute on function public.save_website_source_snapshot(jsonb,jsonb,jsonb) to service_role;
grant execute on function public.search_source_snapshot_pages(text,text[],jsonb,integer) to service_role;
grant execute on function public.apply_prepared_source_recapture(text,jsonb) to service_role;

commit;
