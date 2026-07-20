-- Platform-owned internal redirects for published V4 sites.

create table if not exists site_redirects_v1 (
  id text primary key default ('redirect_' || replace(gen_random_uuid()::text, '-', '')),
  site_id text not null references sites(id) on delete cascade,
  source_path text not null,
  destination_path text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, source_path),
  check (source_path ~ '^/[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$'),
  check (destination_path = '/' or destination_path ~ '^/[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$'),
  check (source_path <> destination_path)
);

create index if not exists site_redirects_v1_active_lookup_idx
  on site_redirects_v1 (site_id, source_path)
  where status = 'active';

alter table site_redirects_v1 enable row level security;

revoke all on table site_redirects_v1 from anon, authenticated;
grant select, insert, update, delete on table site_redirects_v1 to service_role;

create or replace function enforce_active_site_redirect_targets_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  stranded_source text;
begin
  if new.published_version_id is null or new.published_version_id is not distinct from old.published_version_id then
    return new;
  end if;

  select redirect.source_path into stranded_source
  from site_redirects_v1 redirect
  join site_versions_v4 version on version.id = new.published_version_id and version.site_id = new.id
  join site_build_artifacts artifact on artifact.id = version.artifact_id
  where redirect.site_id = new.id
    and redirect.status = 'active'
    and not exists (
      select 1 from jsonb_array_elements(coalesce(artifact.artifact -> 'routes', '[]'::jsonb)) route
      where route ->> 'path' = redirect.source_path
    )
    and not exists (
      select 1 from jsonb_array_elements(coalesce(artifact.artifact -> 'routes', '[]'::jsonb)) route
      where route ->> 'path' = redirect.destination_path
    )
  limit 1;

  if stranded_source is not null then
    raise exception 'active_redirect_destination_missing:%', stranded_source;
  end if;
  return new;
end;
$$;

drop trigger if exists sites_enforce_active_redirect_targets_v1 on sites;
create trigger sites_enforce_active_redirect_targets_v1
before update of published_version_id on sites
for each row execute function enforce_active_site_redirect_targets_v1();

revoke all on function enforce_active_site_redirect_targets_v1() from public;
