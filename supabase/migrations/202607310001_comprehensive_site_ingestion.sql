-- Complete website-source capture, hybrid retrieval, candidate URL coverage,
-- and version-managed migration redirects. This is a pre-launch clean cut.

begin;

create extension if not exists vector with schema extensions;

do $$
begin
  if exists (select 1 from public.vertical_demand_events limit 1) then
    raise exception 'comprehensive_site_ingestion_requires_reviewed_prelaunch_reset';
  end if;
end;
$$;

drop table public.vertical_demand_events;

do $$
declare
  function_record record;
  definition text;
begin
  for function_record in
    select oid::regprocedure as identity
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and prokind = 'f'
      and (pg_get_functiondef(oid) like '%domain_context_id%'
       or pg_get_functiondef(oid) like '%domainContext%')
  loop
    definition := pg_get_functiondef(function_record.identity);
    definition := regexp_replace(
      definition,
      E'domain_context_id,[[:space:]]*domain_context_version,[[:space:]]*',
      '',
      'g'
    );
    definition := regexp_replace(
      definition,
      E'public_input_document#>>''\\{domainContext,id\\}'',[[:space:]]*public_input_document#>>''\\{domainContext,version\\}'',[[:space:]]*',
      '',
      'g'
    );
    definition := regexp_replace(
      definition,
      E'media_adoption_document#>>''\\{publicBuildInput,domainContext,id\\}'',[[:space:]]*media_adoption_document#>>''\\{publicBuildInput,domainContext,version\\}'',[[:space:]]*',
      '',
      'g'
    );
    definition := replace(
      definition,
      'coalesce(public_input_document#>>''{domainContext,id}'', ''general_local'')',
      '''general_local'''
    );
    if position('domain_context' in definition) > 0 or position('domainContext' in definition) > 0 then
      raise exception 'domain_context_function_cutover_failed:%', function_record.identity;
    end if;
    execute definition;
  end loop;
end;
$$;

alter table public.site_public_build_inputs
  drop column domain_context_id,
  drop column domain_context_version;

create table public.source_snapshot_objects (
  id text primary key,
  source_snapshot_id text not null references public.source_snapshots(id) on delete restrict,
  schema_version integer not null check (schema_version = 1),
  kind text not null check (kind in ('robots', 'sitemap', 'http_body', 'rendered_dom')),
  requested_url text not null,
  final_url text not null,
  status integer not null check (status between 100 and 599),
  content_type text not null,
  content_encoding text not null check (content_encoding = 'gzip'),
  raw_content_hash text not null,
  blob_content_hash text not null,
  storage_key text not null,
  raw_bytes bigint not null check (raw_bytes >= 0),
  stored_bytes bigint not null check (stored_bytes >= 0),
  captured_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  unique (source_snapshot_id, kind, requested_url, raw_content_hash)
);
create index source_snapshot_objects_snapshot_idx
  on public.source_snapshot_objects(source_snapshot_id, kind, requested_url);
create index source_snapshot_objects_blob_idx
  on public.source_snapshot_objects(blob_content_hash, storage_key);

create table public.source_snapshot_chunks (
  id text primary key,
  source_snapshot_id text not null references public.source_snapshots(id) on delete cascade,
  page_id text not null,
  schema_version integer not null check (schema_version = 1),
  url text not null,
  path text not null,
  title text,
  status integer check (status between 100 and 599),
  indexability text not null check (indexability in ('indexable', 'noindex', 'unknown')),
  sitemap_member boolean not null,
  chunk_index integer not null check (chunk_index >= 0),
  text text not null check (length(text) > 0),
  content_hash text not null,
  search_document tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', text), 'B')
  ) stored,
  embedding extensions.vector(1536),
  producer text not null,
  model text,
  input_hash text not null,
  created_at timestamptz not null,
  stale_at timestamptz,
  regeneration text not null check (regeneration in ('initial', 'regenerated')),
  unique (source_snapshot_id, page_id, chunk_index, content_hash)
);
create index source_snapshot_chunks_snapshot_page_idx
  on public.source_snapshot_chunks(source_snapshot_id, page_id, chunk_index);
create index source_snapshot_chunks_snapshot_path_idx
  on public.source_snapshot_chunks(source_snapshot_id, path);
create index source_snapshot_chunks_search_idx
  on public.source_snapshot_chunks using gin(search_document);
create index source_snapshot_chunks_embedding_idx
  on public.source_snapshot_chunks using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null and stale_at is null;

create table public.site_version_source_coverage (
  version_id text primary key references public.site_versions(id) on delete restrict,
  site_id text not null references public.sites(id) on delete restrict,
  source_snapshot_id text not null references public.source_snapshots(id) on delete restrict,
  schema_version integer not null check (schema_version = 1),
  report jsonb not null,
  generated_at timestamptz not null
);
create index site_version_source_coverage_site_idx
  on public.site_version_source_coverage(site_id, generated_at desc);
create index site_version_source_coverage_source_idx
  on public.site_version_source_coverage(source_snapshot_id);

create table public.site_version_redirects (
  id text primary key,
  version_id text not null references public.site_versions(id) on delete restrict,
  site_id text not null references public.sites(id) on delete restrict,
  schema_version integer not null check (schema_version = 1),
  source_path text not null,
  destination_path text not null,
  reason text,
  created_at timestamptz not null,
  unique (version_id, source_path),
  check (source_path <> destination_path),
  check (source_path <> '/'),
  check (source_path ~ '^/(?:[a-z0-9]+(?:-[a-z0-9]+)*)(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$'),
  check (destination_path = '/' or destination_path ~ '^/(?:[a-z0-9]+(?:-[a-z0-9]+)*)(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$')
);
create index site_version_redirects_site_version_idx
  on public.site_version_redirects(site_id, version_id, source_path);

create or replace function public.bind_site_version_source_migration(
  target_version_id text,
  coverage_document jsonb default null,
  redirects_document jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_version public.site_versions;
  retained_coverage jsonb;
  redirect_document jsonb;
  retained_redirect public.site_version_redirects;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_version_id, 0));
  select * into target_version from public.site_versions where id = target_version_id for update;
  if target_version.id is null then raise exception 'candidate_version_missing'; end if;
  if target_version.status not in ('candidate', 'stale') then raise exception 'candidate_source_migration_not_bindable'; end if;
  if jsonb_typeof(redirects_document) <> 'array' then raise exception 'candidate_redirects_invalid'; end if;

  if coverage_document is not null then
    if (coverage_document->>'schemaVersion')::integer <> 1
      or coverage_document->>'versionId' <> target_version.id
      or coverage_document->>'siteId' <> target_version.site_id
      or coverage_document->>'artifactHash' <> target_version.version->>'artifactHash'
      or not exists (
        select 1 from public.site_version_sources source_reference
        where source_reference.version_id = target_version.id
          and source_reference.source_snapshot_id = coverage_document->>'sourceSnapshotId'
      ) then
      raise exception 'candidate_source_coverage_mismatch';
    end if;
    select report into retained_coverage
      from public.site_version_source_coverage where version_id = target_version.id;
    if retained_coverage is not null and retained_coverage <> coverage_document then
      raise exception 'candidate_source_coverage_immutable';
    end if;
    if retained_coverage is null then
      insert into public.site_version_source_coverage (
        version_id, site_id, source_snapshot_id, schema_version, report, generated_at
      ) values (
        target_version.id, target_version.site_id, coverage_document->>'sourceSnapshotId',
        1, coverage_document, (coverage_document->>'generatedAt')::timestamptz
      );
    end if;
  end if;

  for redirect_document in select value from jsonb_array_elements(redirects_document) loop
    if (redirect_document->>'schemaVersion')::integer <> 1
      or redirect_document->>'versionId' <> target_version.id
      or redirect_document->>'siteId' <> target_version.site_id then
      raise exception 'candidate_redirect_mismatch';
    end if;
    select * into retained_redirect from public.site_version_redirects
      where version_id = target_version.id and source_path = redirect_document->>'sourcePath';
    if retained_redirect.id is not null then
      if retained_redirect.id <> redirect_document->>'id'
        or retained_redirect.destination_path <> redirect_document->>'destinationPath'
        or retained_redirect.reason is distinct from redirect_document->>'reason'
        or retained_redirect.created_at <> (redirect_document->>'createdAt')::timestamptz then
        raise exception 'candidate_redirect_immutable';
      end if;
    else
      insert into public.site_version_redirects (
        id, version_id, site_id, schema_version, source_path, destination_path, reason, created_at
      ) values (
        redirect_document->>'id', target_version.id, target_version.site_id, 1,
        redirect_document->>'sourcePath', redirect_document->>'destinationPath',
        redirect_document->>'reason', (redirect_document->>'createdAt')::timestamptz
      );
    end if;
  end loop;

  if (select count(*) from public.site_version_redirects where version_id = target_version.id)
    <> jsonb_array_length(redirects_document) then
    raise exception 'candidate_redirect_set_immutable';
  end if;
end;
$$;

create or replace function public.search_source_snapshot_chunks(
  search_query text,
  source_ids text[],
  filters jsonb default '{}'::jsonb,
  max_results integer default 20,
  query_embedding extensions.vector(1536) default null
)
returns table (
  source_snapshot_id text,
  page_id text,
  chunk_id text,
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
set search_path = public, extensions
as $$
  with eligible as (
    select chunk.*
    from public.source_snapshot_chunks chunk
    where chunk.stale_at is null
      and (cardinality(source_ids) = 0 or chunk.source_snapshot_id = any(source_ids))
      and (
        not (filters ? 'paths')
        or exists (
          select 1 from jsonb_array_elements_text(filters->'paths') requested_path
          where chunk.path = requested_path or chunk.path like requested_path || '%'
        )
      )
      and (
        not (filters ? 'statuses')
        or chunk.status in (select value::integer from jsonb_array_elements_text(filters->'statuses'))
      )
      and (
        not (filters ? 'indexability')
        or chunk.indexability in (select value from jsonb_array_elements_text(filters->'indexability'))
      )
      and (coalesce((filters->>'sitemapOnly')::boolean, false) = false or chunk.sitemap_member)
  ),
  lexical as (
    select id, row_number() over (
      order by ts_rank_cd(search_document, websearch_to_tsquery('english', search_query)) desc, id
    ) as rank
    from eligible
    where search_document @@ websearch_to_tsquery('english', search_query)
    limit greatest(50, least(max_results * 5, 250))
  ),
  semantic as (
    select id, row_number() over (order by embedding <=> query_embedding, id) as rank
    from eligible
    where query_embedding is not null and embedding is not null
    order by embedding <=> query_embedding, id
    limit greatest(50, least(max_results * 5, 250))
  ),
  fused as (
    select eligible.*,
      coalesce(1.0 / (60.0 + lexical.rank), 0.0)
      + coalesce(1.0 / (60.0 + semantic.rank), 0.0) as fused_score
    from eligible
    left join lexical on lexical.id = eligible.id
    left join semantic on semantic.id = eligible.id
    where lexical.id is not null or semantic.id is not null
  )
  select
    fused.source_snapshot_id,
    fused.page_id,
    fused.id,
    fused.url,
    fused.path,
    fused.title,
    fused.fused_score,
    left(fused.text, 2000),
    fused.content_hash
  from fused
  order by fused.fused_score desc, fused.path, fused.chunk_index
  limit least(greatest(max_results, 1), 50);
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
      and snapshot.payload->>'kind' = 'website-crawl'
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

create trigger validate_site_version_redirects_before_publish
before update of status on public.site_versions
for each row execute function public.validate_site_version_redirects_before_publish();

alter table public.source_snapshot_objects enable row level security;
alter table public.source_snapshot_chunks enable row level security;
alter table public.site_version_source_coverage enable row level security;
alter table public.site_version_redirects enable row level security;
revoke all on table public.source_snapshot_objects, public.source_snapshot_chunks,
  public.site_version_source_coverage, public.site_version_redirects
  from public, anon, authenticated;
revoke all on function public.search_source_snapshot_chunks(text,text[],jsonb,integer,extensions.vector)
  from public, anon, authenticated;
revoke all on function public.bind_site_version_source_migration(text,jsonb,jsonb)
  from public, anon, authenticated;
grant all on table public.source_snapshot_objects, public.source_snapshot_chunks,
  public.site_version_source_coverage, public.site_version_redirects
  to service_role;
grant execute on function public.search_source_snapshot_chunks(text,text[],jsonb,integer,extensions.vector)
  to service_role;
grant execute on function public.bind_site_version_source_migration(text,jsonb,jsonb)
  to service_role;

commit;
