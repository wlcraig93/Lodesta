-- Replace the policy-heavy prospect research model with a small GTM record (v6).
-- Preserve source imports, contacts, locations, licenses, and existing Google
-- Place/review facts. Delete prior research conclusions and their machinery.

create temporary table prospect_contact_cutover on commit drop as
select * from public.prospect_contact_details;

drop view public.prospect_current;
drop view public.prospect_contact_details;

do $$
begin
  if exists (select 1 from public.prospects where do_not_contact)
    or exists (select 1 from public.prospect_contact_points where suppressed_at is not null) then
    raise exception 'Prospect cleanup found contact suppressions; move them to the outreach system before retrying.';
  end if;
end
$$;

create table public.prospect_source_records (
  id text primary key,
  prospect_id text not null references public.prospects(id) on delete restrict,
  source_id text references public.prospect_sources(id) on delete restrict,
  source_run_id text,
  source_record_key text,
  source_url text,
  observed_at timestamptz not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (source_run_id, source_id)
    references public.prospect_source_runs(id, source_id) on delete restrict,
  check (jsonb_typeof(data) = 'object')
);

insert into public.prospect_source_records (
  id, prospect_id, source_id, source_url, observed_at, data, created_at
)
select
  'prospect_source_record_' || md5('legacy-canonical:' || prospect.id),
  prospect.id,
  source.id,
  source.source_url,
  prospect.created_at,
  jsonb_strip_nulls(jsonb_build_object(
    'businessName', prospect.business_name,
    'legalBusinessName', prospect.legal_business_name,
    'dbaName', prospect.dba_name,
    'vertical', prospect.vertical,
    'industryCode', prospect.industry_code,
    'acquisitionSource', prospect.metadata->>'acquisitionSource'
  )),
  prospect.created_at
from public.prospects prospect
left join public.prospect_sources source
  on source.id = prospect.metadata->>'acquisitionSource';

alter table public.prospects
  add column research_state text not null default 'pending'
    check (research_state in ('pending', 'matched', 'ambiguous', 'not_found')),
  add column website_platform text,
  add column website_agency_provider text;

alter table public.prospect_locations
  add column google_business_name text,
  add column google_category text,
  add column google_address text,
  add column google_phone text,
  add column google_website_url text,
  add column google_maps_url text,
  add column google_rating numeric(3,2) check (google_rating between 0 and 5),
  add column google_review_count integer check (google_review_count >= 0);

with resolved_google as (
  select
    observation.*,
    location.id as resolved_location_id
  from public.prospect_observations observation
  join lateral (
    select candidate.id
    from public.prospect_locations candidate
    where candidate.prospect_id = observation.prospect_id
      and candidate.google_place_id = observation.google_place_id
    order by candidate.is_primary desc, candidate.observed_at desc, candidate.id
    limit 1
  ) location on true
  where observation.observation_kind = 'google_business_profile'
    and observation.google_place_id is not null
), latest_google as (
  select distinct on (resolved_location_id)
    resolved_location_id,
    google_place_id,
    google_business_name,
    google_category,
    google_address,
    google_phone,
    google_website_url,
    google_maps_url,
    review_rating,
    review_count
  from resolved_google
  where resolved_location_id is not null
  order by resolved_location_id, (review_count is not null) desc, observed_at desc, id desc
)
update public.prospect_locations location
set
  google_place_id = coalesce(location.google_place_id, google.google_place_id),
  google_business_name = google.google_business_name,
  google_category = google.google_category,
  google_address = google.google_address,
  google_phone = google.google_phone,
  google_website_url = google.google_website_url,
  google_maps_url = google.google_maps_url,
  google_rating = google.review_rating,
  google_review_count = google.review_count,
  updated_at = now()
from latest_google google
where location.id = google.resolved_location_id;

update public.prospects prospect
set research_state = case
  when exists (
    select 1 from public.prospect_locations location
    where location.prospect_id = prospect.id and location.google_place_id is not null
  ) then 'matched'
  else 'pending'
end;

create table public.prospect_contacts (
  id text primary key,
  prospect_id text not null references public.prospects(id) on delete restrict,
  location_id text,
  full_name text,
  role_title text,
  email text,
  phone text,
  source_url text,
  source_id text references public.prospect_sources(id) on delete restrict,
  source_run_id text,
  source_record_key text,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, prospect_id)
    references public.prospect_locations(id, prospect_id) on delete restrict,
  foreign key (source_run_id, source_id)
    references public.prospect_source_runs(id, source_id) on delete restrict,
  check (full_name is not null or email is not null or phone is not null)
);

insert into public.prospect_contacts (
  id, prospect_id, location_id, full_name, role_title, email, phone,
  source_url, source_id, source_run_id, source_record_key, observed_at,
  created_at, updated_at
)
select distinct on (
  prospect_id,
  coalesce(location_id, ''),
  coalesce(full_name, ''),
  coalesce(role_title, ''),
  coalesce(email, ''),
  coalesce(phone, ''),
  coalesce(source_url, ''),
  coalesce(source_record_key, '')
)
  'prospect_contact_' || md5(concat_ws('|',
    prospect_id,
    coalesce(location_id, ''),
    coalesce(full_name, ''),
    coalesce(role_title, ''),
    coalesce(email, ''),
    coalesce(phone, ''),
    coalesce(source_url, ''),
    coalesce(source_record_key, '')
  )),
  prospect_id,
  location_id,
  full_name,
  role_title,
  email,
  phone,
  source_url,
  source_id,
  source_run_id,
  source_record_key,
  observed_at,
  created_at,
  updated_at
from prospect_contact_cutover
where full_name is not null or email is not null or phone is not null
order by
  prospect_id,
  coalesce(location_id, ''),
  coalesce(full_name, ''),
  coalesce(role_title, ''),
  coalesce(email, ''),
  coalesce(phone, ''),
  coalesce(source_url, ''),
  coalesce(source_record_key, ''),
  observed_at desc,
  id desc;

drop function public.prune_prospect_source_snapshot(text, text[]);

alter table public.outbound_prospects
  drop constraint outbound_prospects_selection_observation_id_fkey,
  drop column selection_observation_id;

drop table public.prospect_contact_point_observations;
drop table public.prospect_person_observations;
drop table public.prospect_contact_points;
drop table public.prospect_people;
drop table public.prospect_organization_memberships;
drop table public.prospect_organization_groups;
drop table public.prospect_observations;
drop function public.prospect_identity_basis_is_valid(text, text, jsonb);

alter table public.prospects
  drop column legal_business_name,
  drop column dba_name,
  drop column industry_code,
  drop column market,
  drop column ownership_scope,
  drop column location_research_status,
  drop column eligibility_status,
  drop column disqualification_reason,
  drop column eligibility_reason,
  drop column eligibility_policy_version,
  drop column eligibility_source,
  drop column eligibility_assessed_at,
  drop column status,
  drop column website_kind,
  drop column website_host,
  drop column do_not_contact,
  drop column suppression_reason,
  drop column metadata;

create index prospects_research_state_idx
  on public.prospects(research_state, updated_at desc);
create index prospects_vertical_idx
  on public.prospects(vertical, updated_at desc)
  where vertical is not null;
create index prospect_source_records_prospect_idx
  on public.prospect_source_records(prospect_id, observed_at desc);
create index prospect_source_records_source_idx
  on public.prospect_source_records(source_id, source_record_key)
  where source_id is not null;
create index prospect_contacts_prospect_idx
  on public.prospect_contacts(prospect_id, observed_at desc);
create index prospect_locations_place_idx
  on public.prospect_locations(google_place_id)
  where google_place_id is not null;

create trigger prospect_contacts_updated_at
  before update on public.prospect_contacts
  for each row execute function public.set_updated_at();

create or replace function public.prune_prospect_source_snapshot(
  p_source_id text,
  p_retained_canonical_keys text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  removable_ids text[];
  deleted_prospects integer := 0;
  deleted_locations integer := 0;
  deleted_licenses integer := 0;
  deleted_contacts integer := 0;
  deleted_source_records integer := 0;
begin
  if p_source_id is null or btrim(p_source_id) = '' then
    raise exception 'prospect source ID is required';
  end if;

  select coalesce(array_agg(distinct prospect.id), '{}'::text[])
  into removable_ids
  from public.prospects prospect
  join public.prospect_source_records source_record on source_record.prospect_id = prospect.id
  where source_record.source_id = p_source_id
    and not (prospect.canonical_key = any(coalesce(p_retained_canonical_keys, '{}'::text[])));

  if cardinality(removable_ids) = 0 then
    return jsonb_build_object(
      'prospects', 0,
      'locations', 0,
      'licenses', 0,
      'contacts', 0,
      'sourceRecords', 0
    );
  end if;

  if exists (
    select 1 from public.outbound_prospects membership
    where membership.prospect_id = any(removable_ids)
  ) then
    raise exception 'prospect source snapshot includes a prospect selected into outbound work';
  end if;

  delete from public.prospect_contacts where prospect_id = any(removable_ids);
  get diagnostics deleted_contacts = row_count;
  delete from public.prospect_licenses where prospect_id = any(removable_ids);
  get diagnostics deleted_licenses = row_count;
  delete from public.prospect_locations where prospect_id = any(removable_ids);
  get diagnostics deleted_locations = row_count;
  delete from public.prospect_source_records where prospect_id = any(removable_ids);
  get diagnostics deleted_source_records = row_count;
  delete from public.prospects where id = any(removable_ids);
  get diagnostics deleted_prospects = row_count;

  return jsonb_build_object(
    'prospects', deleted_prospects,
    'locations', deleted_locations,
    'licenses', deleted_licenses,
    'contacts', deleted_contacts,
    'sourceRecords', deleted_source_records
  );
end
$$;

create view public.prospect_current
with (security_invoker = true)
as
select
  prospect.id,
  prospect.canonical_key,
  prospect.business_name,
  prospect.vertical,
  prospect.research_state,
  prospect.website_url,
  prospect.website_platform,
  prospect.website_agency_provider,
  primary_location.address_line_1,
  primary_location.address_line_2,
  primary_location.locality,
  primary_location.region,
  primary_location.postal_code,
  primary_location.country_code,
  primary_location.county,
  primary_location.google_business_name,
  primary_location.google_category,
  primary_location.google_address,
  primary_location.google_phone,
  primary_location.google_website_url,
  primary_location.google_maps_url,
  primary_location.google_place_id,
  primary_location.google_rating,
  primary_location.google_review_count,
  contacts.owner_name,
  contacts.primary_contact_name,
  contacts.public_email,
  contacts.public_phone,
  coalesce(contacts.contact_details, '[]'::jsonb) as contact_details,
  prospect.created_at,
  prospect.updated_at
from public.prospects prospect
left join lateral (
  select location.*
  from public.prospect_locations location
  where location.prospect_id = prospect.id and location.status <> 'inactive'
  order by
    (location.google_place_id is not null) desc,
    location.is_primary desc,
    location.observed_at desc,
    location.id
  limit 1
) primary_location on true
left join lateral (
  select
    (array_agg(contact.full_name order by contact.observed_at desc)
      filter (where lower(coalesce(contact.role_title, '')) similar to '%(owner|founder|principal)%'))[1] as owner_name,
    (array_agg(contact.full_name order by contact.observed_at desc)
      filter (where contact.full_name is not null))[1] as primary_contact_name,
    (array_agg(contact.email order by contact.observed_at desc)
      filter (where contact.email is not null))[1] as public_email,
    (array_agg(contact.phone order by contact.observed_at desc)
      filter (where contact.phone is not null))[1] as public_phone,
    jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', contact.id,
      'locationId', contact.location_id,
      'fullName', contact.full_name,
      'roleTitle', contact.role_title,
      'email', contact.email,
      'phone', contact.phone,
      'sourceUrl', contact.source_url,
      'sourceRecordKey', contact.source_record_key,
      'observedAt', contact.observed_at
    )) order by contact.observed_at desc, contact.id) as contact_details
  from public.prospect_contacts contact
  where contact.prospect_id = prospect.id
) contacts on true;

alter table public.prospect_source_records enable row level security;
alter table public.prospect_contacts enable row level security;

revoke all on table public.prospect_source_records from public, anon, authenticated;
revoke all on table public.prospect_contacts from public, anon, authenticated;
revoke all on table public.prospect_current from public, anon, authenticated;
revoke all on function public.prune_prospect_source_snapshot(text, text[]) from public, anon, authenticated;

grant select, insert, update on table public.prospect_source_records to service_role;
grant select, insert, update on table public.prospect_contacts to service_role;
grant select on table public.prospect_current to service_role;
grant execute on function public.prune_prospect_source_snapshot(text, text[]) to service_role;
