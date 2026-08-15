-- Persist large website mirrors in bounded canonical batches. A snapshot row is
-- invisible to readers until its complete resource/page manifest is present.

begin;

alter table public.source_snapshots
  add column ready_at timestamptz;

update public.source_snapshots
set ready_at = created_at
where ready_at is null;

alter table public.source_snapshots
  alter column ready_at set default now();

create or replace function public.begin_incremental_website_source_snapshot(
  snapshot_document jsonb,
  expected_resource_count integer,
  expected_page_count integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_snapshot_id text := snapshot_document->>'id';
  retained public.source_snapshots;
begin
  if (snapshot_document->>'schemaVersion')::integer is distinct from 1
    or snapshot_document->>'sourceType' is distinct from 'website'
    or snapshot_document#>>'{payload,kind}' is distinct from 'website-mirror'
    or expected_resource_count is null
    or expected_page_count is null
    or expected_resource_count < 0
    or expected_page_count < 0 then
    raise exception 'website_source_snapshot_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_snapshot_id, 0));

  select * into retained
  from public.source_snapshots
  where id = target_snapshot_id
  for update;

  if retained.id is not null then
    if retained.business_id <> snapshot_document->>'businessId'
      or retained.source_type <> 'website'
      or retained.content_hash <> snapshot_document->>'contentHash' then
      raise exception 'source_snapshot_conflict';
    end if;
    return retained.ready_at is not null;
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
    null
  );

  return false;
end;
$$;

create or replace function public.complete_incremental_website_source_snapshot(
  target_snapshot_id text,
  expected_resource_count integer,
  expected_page_count integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  retained public.source_snapshots;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_snapshot_id, 0));

  select * into retained
  from public.source_snapshots
  where id = target_snapshot_id
  for update;

  if retained.id is null
    or retained.source_type <> 'website'
    or retained.payload->>'kind' <> 'website-mirror' then
    raise exception 'website_source_snapshot_missing';
  end if;

  if (select count(*) from public.source_snapshot_resources where source_snapshot_id = target_snapshot_id)
      <> expected_resource_count
    or (select count(*) from public.source_snapshot_pages where source_snapshot_id = target_snapshot_id)
      <> expected_page_count then
    raise exception 'website_source_snapshot_manifest_incomplete';
  end if;

  update public.source_snapshots
  set ready_at = coalesce(ready_at, now())
  where id = target_snapshot_id;
end;
$$;

create or replace function public.require_ready_public_build_input_source()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.source_snapshots
    where id = new.source_snapshot_id
      and ready_at is not null
  ) then
    raise exception 'public_build_input_source_not_ready';
  end if;
  return new;
end;
$$;

create trigger site_public_build_input_sources_require_ready
before insert or update on public.site_public_build_input_sources
for each row execute function public.require_ready_public_build_input_source();

do $$
begin
  if exists (select 1 from public.website_source_snapshot_staging)
    or exists (select 1 from public.website_source_snapshot_staging_documents) then
    raise exception 'website_source_snapshot_staging_not_empty';
  end if;
end;
$$;

drop function public.finalize_staged_website_source_snapshot(text);
drop function public.stage_website_source_snapshot_documents(text,text,jsonb);
drop function public.begin_website_source_snapshot_staging(jsonb,integer,integer);
drop table public.website_source_snapshot_staging_documents;
drop table public.website_source_snapshot_staging;

revoke all on function public.begin_incremental_website_source_snapshot(jsonb,integer,integer)
  from public, anon, authenticated;
revoke all on function public.complete_incremental_website_source_snapshot(text,integer,integer)
  from public, anon, authenticated;
revoke all on function public.require_ready_public_build_input_source()
  from public, anon, authenticated;
grant execute on function public.begin_incremental_website_source_snapshot(jsonb,integer,integer)
  to service_role;
grant execute on function public.complete_incremental_website_source_snapshot(text,integer,integer)
  to service_role;

commit;
