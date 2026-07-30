-- Normalize durable prospect research away from campaign membership.
-- Existing outbound rows are retained, backfilled into canonical prospects,
-- and linked to an immutable cutover observation before duplicate fields are removed.

create table public.prospects (
  id text primary key,
  canonical_key text not null unique,
  business_name text not null,
  legal_business_name text,
  dba_name text,
  vertical text,
  industry_code text,
  ownership_scope text not null default 'unknown'
    check (ownership_scope in (
      'independent_single_location',
      'independent_multi_location',
      'regional_independent',
      'franchisee',
      'corporate_chain',
      'unknown'
    )),
  status text not null default 'active'
    check (status in ('active', 'suppressed', 'converted', 'archived')),
  website_kind text not null default 'unknown'
    check (website_kind in ('owned_website', 'no_website', 'social_or_aggregator', 'unknown')),
  website_url text,
  website_host text,
  address_line_1 text,
  address_line_2 text,
  locality text,
  region text,
  postal_code text,
  country_code text not null default 'US'
    check (country_code ~ '^[A-Z]{2}$'),
  phone text,
  do_not_contact boolean not null default false,
  suppression_reason text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (website_kind <> 'owned_website' or website_url is not null),
  check (not do_not_contact or suppression_reason is not null)
);

create table public.prospect_sources (
  id text primary key,
  vertical text not null,
  jurisdiction text not null,
  authority_name text not null,
  source_name text not null,
  source_url text not null,
  access_method text not null
    check (access_method in ('csv', 'xlsx', 'json', 'api', 'pdf', 'search', 'manual_request', 'unavailable')),
  coverage_status text not null
    check (coverage_status in ('complete', 'partial', 'blocked', 'unresearched', 'retired')),
  record_scope text not null
    check (record_scope in ('business', 'location', 'licensee', 'mixed')),
  refresh_cadence text,
  expected_record_count integer check (expected_record_count >= 0),
  access_notes text,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.prospect_source_runs (
  id text primary key,
  source_id text not null references public.prospect_sources(id) on delete restrict,
  status text not null
    check (status in ('running', 'succeeded', 'partial', 'failed')),
  started_at timestamptz not null,
  finished_at timestamptz,
  snapshot_at timestamptz,
  source_hash text,
  records_seen integer not null default 0 check (records_seen >= 0),
  organizations_upserted integer not null default 0 check (organizations_upserted >= 0),
  locations_upserted integer not null default 0 check (locations_upserted >= 0),
  licenses_upserted integer not null default 0 check (licenses_upserted >= 0),
  contacts_upserted integer not null default 0 check (contacts_upserted >= 0),
  rejected_records integer not null default 0 check (rejected_records >= 0),
  error text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'running' or finished_at is not null),
  unique (id, source_id)
);

create table public.prospect_locations (
  id text primary key,
  prospect_id text not null references public.prospects(id) on delete restrict,
  canonical_key text not null,
  kind text not null default 'unknown'
    check (kind in ('headquarters', 'branch', 'service_area', 'mailing', 'unknown')),
  status text not null default 'unknown'
    check (status in ('active', 'inactive', 'unknown')),
  location_name text,
  address_line_1 text,
  address_line_2 text,
  locality text,
  region text,
  postal_code text,
  country_code text not null default 'US'
    check (country_code ~ '^[A-Z]{2}$'),
  county text,
  phone text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  is_primary boolean not null default false,
  source_id text references public.prospect_sources(id) on delete restrict,
  source_run_id text,
  source_record_key text,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (prospect_id, canonical_key),
  unique (id, prospect_id),
  foreign key (source_run_id, source_id)
    references public.prospect_source_runs(id, source_id) on delete restrict
);

create table public.prospect_licenses (
  id text primary key,
  prospect_id text not null references public.prospects(id) on delete restrict,
  location_id text,
  jurisdiction text not null,
  regulator text not null,
  license_type text not null,
  license_number text not null,
  status text not null
    check (status in ('active', 'expired', 'suspended', 'revoked', 'pending', 'unknown')),
  classifications text[] not null default '{}',
  issued_at timestamptz,
  renewed_at timestamptz,
  expires_at timestamptz,
  responsible_person_name text,
  responsible_person_title text,
  source_id text not null references public.prospect_sources(id) on delete restrict,
  source_run_id text,
  source_url text not null,
  source_record_key text,
  observed_at timestamptz not null,
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (prospect_id, jurisdiction, regulator, license_type, license_number),
  foreign key (location_id, prospect_id)
    references public.prospect_locations(id, prospect_id) on delete restrict,
  foreign key (source_run_id, source_id)
    references public.prospect_source_runs(id, source_id) on delete restrict
);

create table public.prospect_affiliations (
  id text primary key,
  prospect_id text not null references public.prospects(id) on delete restrict,
  related_prospect_id text references public.prospects(id) on delete restrict,
  related_organization_name text not null,
  affiliation_type text not null
    check (affiliation_type in ('franchisee_of', 'subsidiary_of', 'operates_brand', 'same_enterprise')),
  confidence text not null
    check (confidence in ('confirmed', 'likely', 'possible')),
  source_url text,
  observed_at timestamptz not null,
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.prospect_observations (
  id text primary key,
  schema_version integer not null check (schema_version = 1),
  prospect_id text not null references public.prospects(id) on delete restrict,
  source_type text not null
    check (source_type in ('manual_research', 'licensed_dataset', 'open_dataset', 'business_website', 'public_listing', 'public_registry', 'owner_verified', 'import')),
  source_url text,
  observed_at timestamptz not null,
  website_kind text not null
    check (website_kind in ('owned_website', 'no_website', 'social_or_aggregator', 'unknown')),
  website_url text,
  review_rating numeric(3,2)
    check (review_rating between 0 and 5),
  review_count integer
    check (review_count >= 0),
  years_in_business numeric(6,2)
    check (years_in_business >= 0),
  cms text,
  site_builder text,
  managed_provider text,
  agency_status text not null default 'unknown'
    check (agency_status in ('confirmed', 'likely', 'not_observed', 'unknown')),
  agency_name text,
  website_assessment_id text references public.website_assessments(id) on delete restrict,
  prospect_report_id text references public.prospect_reports(id) on delete restrict,
  business_strength_score numeric(5,2)
    check (business_strength_score between 0 and 100),
  website_opportunity_score numeric(5,2)
    check (website_opportunity_score between 0 and 100),
  reachability_score numeric(5,2)
    check (reachability_score between 0 and 100),
  priority_score numeric(5,2)
    check (priority_score between 0 and 100),
  scoring_model text,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'partial', 'verified', 'conflicted', 'rejected')),
  verification_score numeric(5,2)
    check (verification_score between 0 and 100),
  operating_status text not null default 'unknown'
    check (operating_status in ('unknown', 'operational', 'temporarily_closed', 'permanently_closed')),
  target_fit_status text not null default 'unknown'
    check (target_fit_status in ('unknown', 'target', 'review_required', 'excluded')),
  target_fit_reason text,
  evidence_coverage numeric(5,4) not null
    check (evidence_coverage between 0 and 1),
  producer text not null,
  methodology_identity text not null,
  input_hash text not null,
  notes text,
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check (website_kind <> 'owned_website' or website_url is not null),
  check (agency_status <> 'confirmed' or agency_name is not null),
  check (target_fit_status not in ('review_required', 'excluded') or target_fit_reason is not null),
  unique (prospect_id, input_hash),
  unique (id, prospect_id)
);

create table public.prospect_contacts (
  id text primary key,
  prospect_id text not null references public.prospects(id) on delete restrict,
  contact_type text not null
    check (contact_type in ('business_general', 'owner', 'manager', 'marketing')),
  full_name text,
  role_title text,
  email text,
  phone text,
  source_type text not null
    check (source_type in ('manual_research', 'licensed_dataset', 'open_dataset', 'business_website', 'public_listing', 'public_registry', 'owner_verified', 'import')),
  source_url text,
  verification_status text not null
    check (verification_status in ('public_source', 'owner_verified', 'unverified')),
  outreach_eligible boolean not null default false,
  observed_at timestamptz not null,
  suppressed_at timestamptz,
  suppression_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (full_name is not null or email is not null or phone is not null),
  check (verification_status <> 'public_source' or source_url is not null),
  check (not outreach_eligible or verification_status in ('public_source', 'owner_verified')),
  check (suppressed_at is null or suppression_reason is not null)
);

create index prospects_status_priority_filters_idx
  on public.prospects(status, vertical, region, industry_code);
create index prospects_website_kind_idx
  on public.prospects(website_kind);
create index prospects_active_website_host_idx
  on public.prospects(website_host)
  where status = 'active' and website_host is not null;
create index prospects_do_not_contact_idx
  on public.prospects(updated_at desc)
  where do_not_contact;

create index prospect_sources_vertical_coverage_idx
  on public.prospect_sources(vertical, coverage_status, jurisdiction);
create index prospect_source_runs_source_latest_idx
  on public.prospect_source_runs(source_id, started_at desc, id desc);
create index prospect_locations_prospect_status_idx
  on public.prospect_locations(prospect_id, status, is_primary desc);
create index prospect_locations_region_locality_idx
  on public.prospect_locations(region, locality, prospect_id)
  where status <> 'inactive';
create unique index prospect_locations_one_primary_idx
  on public.prospect_locations(prospect_id)
  where is_primary;
create index prospect_locations_source_run_idx
  on public.prospect_locations(source_run_id)
  where source_run_id is not null;
create index prospect_licenses_prospect_status_idx
  on public.prospect_licenses(prospect_id, status, jurisdiction);
create index prospect_licenses_active_expiry_idx
  on public.prospect_licenses(jurisdiction, expires_at, prospect_id)
  where status = 'active';
create index prospect_licenses_location_idx
  on public.prospect_licenses(location_id)
  where location_id is not null;
create index prospect_licenses_source_run_idx
  on public.prospect_licenses(source_run_id)
  where source_run_id is not null;
create index prospect_affiliations_prospect_type_idx
  on public.prospect_affiliations(prospect_id, affiliation_type, confidence);
create index prospect_affiliations_related_prospect_idx
  on public.prospect_affiliations(related_prospect_id)
  where related_prospect_id is not null;

create index prospect_observations_prospect_latest_idx
  on public.prospect_observations(prospect_id, observed_at desc, id desc);
create index prospect_observations_priority_idx
  on public.prospect_observations(priority_score desc, prospect_id)
  where priority_score is not null;
create index prospect_observations_provider_filters_idx
  on public.prospect_observations(cms, managed_provider, agency_status);
create index prospect_observations_verification_filters_idx
  on public.prospect_observations(verification_status, operating_status, target_fit_status, verification_score desc);
create index prospect_observations_assessment_idx
  on public.prospect_observations(website_assessment_id)
  where website_assessment_id is not null;
create index prospect_observations_report_idx
  on public.prospect_observations(prospect_report_id)
  where prospect_report_id is not null;

create index prospect_contacts_prospect_idx
  on public.prospect_contacts(prospect_id, contact_type);
create unique index prospect_contacts_email_unique
  on public.prospect_contacts(prospect_id, lower(email))
  where email is not null;
create unique index prospect_contacts_phone_unique
  on public.prospect_contacts(prospect_id, phone)
  where phone is not null;
create index prospect_contacts_outreach_idx
  on public.prospect_contacts(prospect_id, contact_type)
  where outreach_eligible and suppressed_at is null;

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
  deleted_affiliations integer := 0;
  deleted_observations integer := 0;
  deleted_contacts integer := 0;
begin
  if p_source_id is null or btrim(p_source_id) = '' then
    raise exception 'prospect source ID is required';
  end if;

  select coalesce(array_agg(prospect.id), '{}'::text[])
  into removable_ids
  from public.prospects prospect
  where prospect.metadata ->> 'acquisitionSource' = p_source_id
    and not (
      prospect.canonical_key = any(coalesce(p_retained_canonical_keys, '{}'::text[]))
    );

  if cardinality(removable_ids) = 0 then
    return jsonb_build_object(
      'prospects', 0,
      'locations', 0,
      'licenses', 0,
      'affiliations', 0,
      'observations', 0,
      'contacts', 0
    );
  end if;

  if exists (
    select 1
    from public.outbound_prospects membership
    where membership.prospect_id = any(removable_ids)
  ) then
    raise exception 'prospect source snapshot includes a prospect selected into outbound work';
  end if;

  if exists (
    select 1
    from public.prospect_observations observation
    where observation.prospect_id = any(removable_ids)
      and (
        observation.website_assessment_id is not null
        or observation.prospect_report_id is not null
      )
  ) then
    raise exception 'prospect source snapshot includes an observation linked to a report or assessment';
  end if;

  delete from public.prospect_affiliations affiliation
  where affiliation.prospect_id = any(removable_ids)
    or affiliation.related_prospect_id = any(removable_ids);
  get diagnostics deleted_affiliations = row_count;

  delete from public.prospect_contacts contact
  where contact.prospect_id = any(removable_ids);
  get diagnostics deleted_contacts = row_count;

  delete from public.prospect_observations observation
  where observation.prospect_id = any(removable_ids);
  get diagnostics deleted_observations = row_count;

  delete from public.prospect_licenses license
  where license.prospect_id = any(removable_ids);
  get diagnostics deleted_licenses = row_count;

  delete from public.prospect_locations location
  where location.prospect_id = any(removable_ids);
  get diagnostics deleted_locations = row_count;

  delete from public.prospects prospect
  where prospect.id = any(removable_ids);
  get diagnostics deleted_prospects = row_count;

  return jsonb_build_object(
    'prospects', deleted_prospects,
    'locations', deleted_locations,
    'licenses', deleted_licenses,
    'affiliations', deleted_affiliations,
    'observations', deleted_observations,
    'contacts', deleted_contacts
  );
end
$$;

with legacy as (
  select
    outbound.*,
    case
      when outbound.source_url is not null then
        'website:' || lower(split_part(split_part(split_part(
          regexp_replace(regexp_replace(trim(outbound.source_url), '^https?://', '', 'i'), '^www\.', '', 'i'),
          '/',
          1
        ), '?', 1), '#', 1))
      else
        'legacy:' || md5(lower(trim(outbound.business_name)) || '|' || lower(coalesce(outbound.vertical, '')))
    end as canonical_key
  from public.outbound_prospects outbound
)
insert into public.prospects (
  id,
  canonical_key,
  business_name,
  vertical,
  website_kind,
  website_url,
  website_host,
  created_at,
  updated_at
)
select distinct on (legacy.canonical_key)
  'prospect_' || md5(legacy.canonical_key),
  legacy.canonical_key,
  legacy.business_name,
  legacy.vertical,
  case when legacy.source_url is null then 'unknown' else 'owned_website' end,
  legacy.source_url,
  case
    when legacy.source_url is null then null
    else lower(split_part(regexp_replace(regexp_replace(trim(legacy.source_url), '^https?://', '', 'i'), '^www\.', '', 'i'), '/', 1))
  end,
  legacy.created_at,
  legacy.created_at
from legacy
order by legacy.canonical_key, legacy.created_at;

alter table public.outbound_prospects
  add column prospect_id text,
  add column selection_observation_id text;

with legacy as (
  select
    outbound.id,
    case
      when outbound.source_url is not null then
        'website:' || lower(split_part(split_part(split_part(
          regexp_replace(regexp_replace(trim(outbound.source_url), '^https?://', '', 'i'), '^www\.', '', 'i'),
          '/',
          1
        ), '?', 1), '#', 1))
      else
        'legacy:' || md5(lower(trim(outbound.business_name)) || '|' || lower(coalesce(outbound.vertical, '')))
    end as canonical_key
  from public.outbound_prospects outbound
)
update public.outbound_prospects outbound
set prospect_id = prospect.id
from legacy
join public.prospects prospect on prospect.canonical_key = legacy.canonical_key
where outbound.id = legacy.id;

insert into public.prospect_observations (
  id,
  schema_version,
  prospect_id,
  source_type,
  source_url,
  observed_at,
  website_kind,
  website_url,
  agency_status,
  evidence_coverage,
  producer,
  methodology_identity,
  input_hash,
  notes,
  evidence,
  created_at
)
select
  'prospect_observation_' || md5('legacy-outbound:' || outbound.id),
  1,
  outbound.prospect_id,
  'import',
  outbound.source_url,
  outbound.created_at,
  case when outbound.source_url is null then 'unknown' else 'owned_website' end,
  outbound.source_url,
  'unknown',
  0,
  'normalized-prospect-cutover',
  'normalized-prospect-cutover',
  'legacy-outbound:' || outbound.id,
  'Backfilled from the pre-normalization outbound campaign record.',
  jsonb_build_object('legacyOutboundProspectId', outbound.id),
  outbound.created_at
from public.outbound_prospects outbound;

update public.outbound_prospects outbound
set selection_observation_id = observation.id
from public.prospect_observations observation
where observation.input_hash = 'legacy-outbound:' || outbound.id;

do $$
begin
  if exists (
    select 1 from public.outbound_prospects
    where prospect_id is null or selection_observation_id is null
  ) then
    raise exception 'normalized prospect cutover left campaign membership without a canonical prospect or observation';
  end if;
  if exists (
    select 1
    from public.outbound_prospects
    group by campaign_id, prospect_id
    having count(*) > 1
  ) then
    raise exception 'normalized prospect cutover found duplicate campaign membership; inspect and resolve retained rows before retrying';
  end if;
end
$$;

alter table public.outbound_prospects
  alter column prospect_id set not null,
  alter column selection_observation_id set not null,
  add constraint outbound_prospects_prospect_id_fkey
    foreign key (prospect_id) references public.prospects(id) on delete restrict,
  add constraint outbound_prospects_selection_observation_id_fkey
    foreign key (selection_observation_id, prospect_id)
    references public.prospect_observations(id, prospect_id) on delete restrict,
  add constraint outbound_prospects_campaign_prospect_unique
    unique (campaign_id, prospect_id),
  drop column business_name,
  drop column vertical,
  drop column source_url;

create index outbound_prospects_prospect_id_idx
  on public.outbound_prospects(prospect_id);
create index outbound_prospects_selection_observation_id_idx
  on public.outbound_prospects(selection_observation_id);

create trigger prospects_updated_at
  before update on public.prospects
  for each row execute function public.set_updated_at();
create trigger prospect_contacts_updated_at
  before update on public.prospect_contacts
  for each row execute function public.set_updated_at();
create trigger prospect_sources_updated_at
  before update on public.prospect_sources
  for each row execute function public.set_updated_at();
create trigger prospect_source_runs_updated_at
  before update on public.prospect_source_runs
  for each row execute function public.set_updated_at();
create trigger prospect_locations_updated_at
  before update on public.prospect_locations
  for each row execute function public.set_updated_at();
create trigger prospect_licenses_updated_at
  before update on public.prospect_licenses
  for each row execute function public.set_updated_at();
create trigger prospect_affiliations_updated_at
  before update on public.prospect_affiliations
  for each row execute function public.set_updated_at();

create view public.prospect_current
with (security_invoker = true)
as
select
  prospect.id,
  prospect.canonical_key,
  prospect.business_name,
  prospect.legal_business_name,
  prospect.dba_name,
  prospect.vertical,
  prospect.industry_code,
  prospect.ownership_scope,
  prospect.status,
  prospect.website_kind,
  prospect.website_url,
  prospect.website_host,
  prospect.address_line_1,
  prospect.address_line_2,
  prospect.locality,
  prospect.region,
  prospect.postal_code,
  prospect.country_code,
  prospect.phone,
  prospect.do_not_contact,
  prospect.suppression_reason,
  prospect.metadata,
  prospect.created_at,
  prospect.updated_at,
  observation.id as latest_observation_id,
  observation.observed_at as latest_observed_at,
  observation.review_rating,
  observation.review_count,
  observation.years_in_business,
  observation.cms,
  observation.site_builder,
  observation.managed_provider,
  observation.agency_status,
  observation.agency_name,
  observation.website_assessment_id,
  observation.prospect_report_id,
  observation.business_strength_score,
  observation.website_opportunity_score,
  observation.reachability_score,
  observation.priority_score,
  observation.scoring_model,
  observation.verification_status,
  observation.verification_score,
  observation.operating_status,
  observation.target_fit_status,
  observation.target_fit_reason,
  observation.evidence_coverage,
  contacts.owner_name,
  contacts.public_email,
  coalesce(contacts.contact_count, 0)::integer as contact_count,
  coalesce(locations.location_count, 0)::integer as location_count,
  coalesce(licenses.active_license_count, 0)::integer as active_license_count
from public.prospects prospect
left join lateral (
  select current_observation.*
  from public.prospect_observations current_observation
  where current_observation.prospect_id = prospect.id
  order by current_observation.observed_at desc, current_observation.id desc
  limit 1
) observation on true
left join lateral (
  select
    max(contact.full_name) filter (
      where contact.contact_type = 'owner'
        and contact.verification_status in ('public_source', 'owner_verified')
        and contact.suppressed_at is null
    ) as owner_name,
    max(contact.email) filter (
      where contact.outreach_eligible
        and contact.suppressed_at is null
        and not prospect.do_not_contact
    ) as public_email,
    count(*) filter (where contact.suppressed_at is null) as contact_count
  from public.prospect_contacts contact
  where contact.prospect_id = prospect.id
) contacts on true
left join lateral (
  select count(*) as location_count
  from public.prospect_locations location
  where location.prospect_id = prospect.id
    and location.status <> 'inactive'
) locations on true
left join lateral (
  select count(*) as active_license_count
  from public.prospect_licenses license
  where license.prospect_id = prospect.id
    and license.status = 'active'
) licenses on true;

alter table public.prospects enable row level security;
alter table public.prospect_sources enable row level security;
alter table public.prospect_source_runs enable row level security;
alter table public.prospect_locations enable row level security;
alter table public.prospect_licenses enable row level security;
alter table public.prospect_affiliations enable row level security;
alter table public.prospect_observations enable row level security;
alter table public.prospect_contacts enable row level security;

revoke all on table public.prospects from public, anon, authenticated;
revoke all on table public.prospect_sources from public, anon, authenticated;
revoke all on table public.prospect_source_runs from public, anon, authenticated;
revoke all on table public.prospect_locations from public, anon, authenticated;
revoke all on table public.prospect_licenses from public, anon, authenticated;
revoke all on table public.prospect_affiliations from public, anon, authenticated;
revoke all on table public.prospect_observations from public, anon, authenticated;
revoke all on table public.prospect_contacts from public, anon, authenticated;
revoke all on table public.prospect_current from public, anon, authenticated;
revoke all on function public.prune_prospect_source_snapshot(text, text[]) from public, anon, authenticated;

grant select, insert, update on table public.prospects to service_role;
grant select, insert, update on table public.prospect_sources to service_role;
grant select, insert, update on table public.prospect_source_runs to service_role;
grant select, insert, update on table public.prospect_locations to service_role;
grant select, insert, update on table public.prospect_licenses to service_role;
grant select, insert, update on table public.prospect_affiliations to service_role;
grant select, insert on table public.prospect_observations to service_role;
grant select, insert, update on table public.prospect_contacts to service_role;
grant select on table public.prospect_current to service_role;
grant execute on function public.prune_prospect_source_snapshot(text, text[]) to service_role;
