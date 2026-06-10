create table if not exists businesses (
  id text primary key,
  workspace_id text references workspaces(id) on delete cascade,
  name text not null,
  vertical text not null,
  profile_json jsonb not null,
  provenance jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists business_locations (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  label text,
  address jsonb,
  service_areas text[] not null default '{}',
  phone text,
  email text,
  hours jsonb,
  geo jsonb,
  google_place_id text,
  provenance jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table sites add column if not exists business_id text;
alter table sites add column if not exists is_primary boolean not null default true;
alter table site_candidates add column if not exists business_id text;

insert into businesses (id, workspace_id, name, vertical, profile_json, provenance, created_at, updated_at)
select
  'biz_' || substr(md5(bp.id), 1, 24),
  s.workspace_id,
  bp.name,
  bp.vertical,
  bp.profile,
  bp.provenance,
  bp.created_at,
  bp.updated_at
from business_profiles bp
join sites s on s.id = bp.site_id
on conflict (id) do update
set
  workspace_id = excluded.workspace_id,
  name = excluded.name,
  vertical = excluded.vertical,
  profile_json = excluded.profile_json,
  provenance = excluded.provenance,
  updated_at = excluded.updated_at;

update sites s
set business_id = 'biz_' || substr(md5(bp.id), 1, 24)
from business_profiles bp
where bp.site_id = s.id
  and s.business_id is null;

insert into businesses (id, name, vertical, profile_json, provenance)
select
  'biz_' || substr(md5(sc.id), 1, 24),
  sc.business_name,
  sc.vertical,
  coalesce(sc.bundle_json -> 'businessProfile', '{}'::jsonb),
  coalesce(sc.bundle_json -> 'businessProfile' -> 'provenance', '{}'::jsonb)
from site_candidates sc
left join sites accepted_site on accepted_site.id = sc.accepted_site_id
left join sites intended_site on intended_site.id = sc.intended_site_id
where accepted_site.business_id is null
  and intended_site.business_id is null
on conflict (id) do nothing;

update site_candidates sc
set business_id = coalesce(
  (select sites.business_id from sites where sites.id = sc.accepted_site_id),
  (select sites.business_id from sites where sites.id = sc.intended_site_id),
  sc.business_id,
  'biz_' || substr(md5(sc.id), 1, 24)
)
where sc.business_id is null
   or sc.accepted_site_id is not null
   or sc.intended_site_id is not null;

update site_candidates sc
set business_id = 'biz_' || substr(md5(sc.id), 1, 24)
where business_id is null;

insert into business_locations (id, business_id, label, address, service_areas, phone, email, hours, geo, google_place_id, provenance, created_at, updated_at)
select
  'loc_' || substr(md5(bp.id), 1, 24),
  'biz_' || substr(md5(bp.id), 1, 24),
  nullif(bp.profile ->> 'name', ''),
  nullif(bp.profile -> 'address', 'null'::jsonb),
  coalesce(ARRAY(select jsonb_array_elements_text(coalesce(bp.profile -> 'serviceAreas', '[]'::jsonb))), '{}'),
  nullif(bp.profile ->> 'phone', ''),
  nullif(bp.profile ->> 'email', ''),
  nullif(bp.profile -> 'hours', 'null'::jsonb),
  nullif(bp.profile -> 'geo', 'null'::jsonb),
  nullif(bp.profile ->> 'googlePlaceId', ''),
  bp.provenance,
  bp.created_at,
  bp.updated_at
from business_profiles bp
where bp.profile ? 'address'
   or jsonb_array_length(coalesce(bp.profile -> 'serviceAreas', '[]'::jsonb)) > 0
on conflict (id) do update
set
  address = excluded.address,
  service_areas = excluded.service_areas,
  phone = excluded.phone,
  email = excluded.email,
  hours = excluded.hours,
  geo = excluded.geo,
  google_place_id = excluded.google_place_id,
  provenance = excluded.provenance,
  updated_at = excluded.updated_at;

create table if not exists site_locations (
  site_id text not null references sites(id) on delete cascade,
  location_id text not null references business_locations(id) on delete cascade,
  role text not null default 'covered' check (role in ('primary', 'covered')),
  created_at timestamptz not null default now(),
  primary key (site_id, location_id)
);

insert into site_locations (site_id, location_id, role)
select
  bp.site_id,
  'loc_' || substr(md5(bp.id), 1, 24),
  'primary'
from business_profiles bp
where exists (
  select 1 from business_locations bl where bl.id = 'loc_' || substr(md5(bp.id), 1, 24)
)
on conflict (site_id, location_id) do nothing;

alter table sites alter column business_id set not null;
alter table site_candidates alter column business_id set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sites_business_id_fkey') then
    alter table sites add constraint sites_business_id_fkey foreign key (business_id) references businesses(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'site_candidates_business_id_fkey') then
    alter table site_candidates add constraint site_candidates_business_id_fkey foreign key (business_id) references businesses(id) on delete restrict;
  end if;
end $$;

create index if not exists businesses_workspace_idx on businesses(workspace_id);
create index if not exists businesses_name_idx on businesses(name);
create index if not exists business_locations_business_idx on business_locations(business_id);
create index if not exists business_locations_google_place_idx on business_locations(google_place_id) where google_place_id is not null;
create index if not exists sites_business_idx on sites(business_id);
create unique index if not exists sites_one_primary_per_business_idx on sites(business_id) where is_primary;
create index if not exists site_locations_location_idx on site_locations(location_id);
create index if not exists site_candidates_business_idx on site_candidates(business_id);

alter table businesses enable row level security;
alter table business_locations enable row level security;
alter table site_locations enable row level security;

grant select, insert, update, delete on businesses to service_role;
grant select, insert, update, delete on business_locations to service_role;
grant select, insert, update, delete on site_locations to service_role;

create or replace function public.merge_businesses(source_business_id text, target_business_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  moved_sites integer := 0;
  moved_site_candidates integer := 0;
  moved_locations integer := 0;
  target_has_primary boolean := false;
begin
  if source_business_id is null or target_business_id is null or source_business_id = '' or target_business_id = '' then
    return jsonb_build_object('ok', false, 'reason', 'Source and target business ids are required.');
  end if;
  if source_business_id = target_business_id then
    return jsonb_build_object('ok', false, 'reason', 'Source and target business ids must differ.');
  end if;
  if not exists (select 1 from businesses where id = source_business_id) then
    return jsonb_build_object('ok', false, 'reason', 'Source business not found.');
  end if;
  if not exists (select 1 from businesses where id = target_business_id) then
    return jsonb_build_object('ok', false, 'reason', 'Target business not found.');
  end if;

  select exists(select 1 from sites where business_id = target_business_id and is_primary) into target_has_primary;
  if target_has_primary then
    update sites
    set is_primary = false
    where business_id = source_business_id
      and is_primary;
  end if;

  update sites
  set business_id = target_business_id
  where business_id = source_business_id;
  get diagnostics moved_sites = row_count;

  update site_candidates
  set business_id = target_business_id,
      updated_at = now()
  where business_id = source_business_id;
  get diagnostics moved_site_candidates = row_count;

  update business_locations
  set business_id = target_business_id,
      updated_at = now()
  where business_id = source_business_id;
  get diagnostics moved_locations = row_count;

  delete from businesses where id = source_business_id;

  return jsonb_build_object(
    'ok', true,
    'sourceBusinessId', source_business_id,
    'targetBusinessId', target_business_id,
    'movedSites', moved_sites,
    'movedSiteCandidates', moved_site_candidates,
    'movedLocations', moved_locations
  );
end;
$$;

grant execute on function public.merge_businesses(text, text) to service_role;
