-- Let multiple business-scoped SourceSnapshot authorities reference one exact,
-- immutable retained website mirror. The authority row remains business-bound;
-- only the large page/resource corpus is shared.

begin;

create table public.source_snapshot_mirror_references (
  source_snapshot_id text primary key
    references public.source_snapshots(id) on delete restrict,
  retained_source_snapshot_id text not null
    references public.source_snapshots(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (source_snapshot_id <> retained_source_snapshot_id)
);

create index source_snapshot_mirror_references_retained_idx
  on public.source_snapshot_mirror_references(retained_source_snapshot_id);

create index source_snapshots_ready_website_identity_idx
  on public.source_snapshots(source_url, content_hash, captured_at desc, id)
  where source_type = 'website' and ready_at is not null;

create or replace function public.find_reusable_website_source_snapshot(
  target_source_url text,
  target_content_hash text
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select snapshot.id
  from public.source_snapshots snapshot
  left join public.source_snapshot_mirror_references reference
    on reference.source_snapshot_id = snapshot.id
  where snapshot.source_type = 'website'
    and snapshot.payload->>'kind' = 'website-mirror'
    and snapshot.source_url = target_source_url
    and snapshot.content_hash = target_content_hash
    and snapshot.ready_at is not null
    and reference.source_snapshot_id is null
  order by snapshot.captured_at desc, snapshot.id
  limit 1;
$$;

create or replace function public.retain_website_source_snapshot_reference(
  snapshot_document jsonb,
  target_retained_source_snapshot_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_snapshot_id text := snapshot_document->>'id';
  retained public.source_snapshots;
  existing_reference text;
begin
  if (snapshot_document->>'schemaVersion')::integer is distinct from 1
    or snapshot_document->>'sourceType' is distinct from 'website'
    or snapshot_document#>>'{payload,kind}' is distinct from 'website-mirror'
    or target_snapshot_id is null
    or target_retained_source_snapshot_id is null
    or target_snapshot_id = target_retained_source_snapshot_id then
    raise exception 'website_source_snapshot_reference_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_snapshot_id, 0));

  select snapshot.* into retained
  from public.source_snapshots snapshot
  where snapshot.id = target_retained_source_snapshot_id
    and snapshot.ready_at is not null
  for share;

  if retained.id is null
    or retained.source_type <> 'website'
    or retained.payload->>'kind' <> 'website-mirror'
    or retained.content_hash <> snapshot_document->>'contentHash'
    or retained.source_url is distinct from snapshot_document->>'sourceUrl'
    or exists (
      select 1 from public.source_snapshot_mirror_references reference
      where reference.source_snapshot_id = retained.id
    ) then
    raise exception 'retained_website_source_snapshot_mismatch';
  end if;

  insert into public.source_snapshots (
    id, business_id, schema_version, source_type, source_url, content_hash,
    captured_at, payload, ready_at
  ) values (
    target_snapshot_id,
    snapshot_document->>'businessId',
    1,
    'website',
    snapshot_document->>'sourceUrl',
    snapshot_document->>'contentHash',
    (snapshot_document->>'capturedAt')::timestamptz,
    snapshot_document->'payload',
    now()
  ) on conflict (id) do nothing;

  if not exists (
    select 1 from public.source_snapshots snapshot
    where snapshot.id = target_snapshot_id
      and snapshot.business_id = snapshot_document->>'businessId'
      and snapshot.source_type = 'website'
      and snapshot.source_url is not distinct from snapshot_document->>'sourceUrl'
      and snapshot.content_hash = snapshot_document->>'contentHash'
      and snapshot.payload = snapshot_document->'payload'
      and snapshot.ready_at is not null
  ) then
    raise exception 'source_snapshot_conflict';
  end if;

  if exists (
    select 1 from public.source_snapshot_resources resource
    where resource.source_snapshot_id = target_snapshot_id
  ) or exists (
    select 1 from public.source_snapshot_pages page
    where page.source_snapshot_id = target_snapshot_id
  ) then
    raise exception 'source_snapshot_reference_has_owned_mirror_rows';
  end if;

  insert into public.source_snapshot_mirror_references (
    source_snapshot_id, retained_source_snapshot_id
  ) values (
    target_snapshot_id, target_retained_source_snapshot_id
  ) on conflict (source_snapshot_id) do nothing;

  select reference.retained_source_snapshot_id into existing_reference
  from public.source_snapshot_mirror_references reference
  where reference.source_snapshot_id = target_snapshot_id;

  if existing_reference is distinct from target_retained_source_snapshot_id then
    raise exception 'source_snapshot_mirror_reference_conflict';
  end if;
end;
$$;

create or replace function public.reject_mirror_reference_owned_rows()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1 from public.source_snapshot_mirror_references reference
    where reference.source_snapshot_id = new.source_snapshot_id
  ) then
    raise exception 'source_snapshot_reference_cannot_own_mirror_rows';
  end if;
  return new;
end;
$$;

create trigger source_snapshot_resources_reject_reference_owner
before insert or update on public.source_snapshot_resources
for each row execute function public.reject_mirror_reference_owned_rows();

create trigger source_snapshot_pages_reject_reference_owner
before insert or update on public.source_snapshot_pages
for each row execute function public.reject_mirror_reference_owned_rows();

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
  ), source_scope as (
    select
      requested.id as requested_source_snapshot_id,
      coalesce(reference.retained_source_snapshot_id, requested.id) as retained_source_snapshot_id
    from public.source_snapshots requested
    left join public.source_snapshot_mirror_references reference
      on reference.source_snapshot_id = requested.id
    where requested.ready_at is not null
      and (
        (coalesce(cardinality(source_ids), 0) = 0 and reference.source_snapshot_id is null)
        or requested.id = any(source_ids)
      )
  )
  select
    scope.requested_source_snapshot_id as source_snapshot_id,
    page.id as page_id,
    coalesce(page.final_url, page.requested_url) as url,
    page.path,
    page.title,
    ts_rank_cd(page.search_document, query.value)::double precision as score,
    ts_headline('english', page.extracted_text, query.value, 'MaxFragments=3,MaxWords=45,MinWords=15') as excerpt,
    page.text_content_hash as content_hash
  from source_scope scope
  join public.source_snapshot_pages page
    on page.source_snapshot_id = scope.retained_source_snapshot_id
  cross join query
  where page.search_document @@ query.value
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

alter table public.source_snapshot_mirror_references enable row level security;

revoke all on table public.source_snapshot_mirror_references from public, anon, authenticated;
revoke all on function public.retain_website_source_snapshot_reference(jsonb,text) from public, anon, authenticated;
revoke all on function public.find_reusable_website_source_snapshot(text,text) from public, anon, authenticated;
revoke all on function public.reject_mirror_reference_owned_rows() from public, anon, authenticated;

grant all on table public.source_snapshot_mirror_references to service_role;
grant execute on function public.retain_website_source_snapshot_reference(jsonb,text) to service_role;
grant execute on function public.find_reusable_website_source_snapshot(text,text) to service_role;

commit;
