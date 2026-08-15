-- Make normalized locations, contact points, and sourced observations the only
-- prospect research authorities. Preserve legacy values before removing the
-- duplicate convenience columns and opaque ranking fields.

begin;

drop view if exists public.prospect_current;
drop view if exists public.prospect_contact_details;

-- Older enrichment runs copied Google and website-provider facts onto unrelated
-- observation kinds before those fields became surface-specific. Preserve the
-- values as evidence, then make the typed columns truthful before touching the
-- retained rows again (the prior constraints were intentionally NOT VALID).
alter table public.prospect_observations
  drop constraint prospect_observations_google_facts_verified_check,
  drop constraint prospect_observations_website_facts_kind_check;

update public.prospect_observations
set
  evidence = coalesce(evidence, '{}'::jsonb) || jsonb_build_object(
    'legacyMisplacedGoogleFacts', jsonb_strip_nulls(jsonb_build_object(
      'reviewRating', review_rating,
      'reviewCount', review_count,
      'googlePlaceId', google_place_id
    ))
  ),
  review_rating = null,
  review_count = null,
  google_place_id = null
where (review_rating is not null or review_count is not null or google_place_id is not null)
  and not (
    observation_kind = 'google_business_profile'
    and identity_match_status = 'verified'
    and identity_verification_level in ('google_verified', 'cross_source_verified')
  );

update public.prospect_observations
set
  evidence = coalesce(evidence, '{}'::jsonb) || jsonb_build_object(
    'legacyMisplacedWebsiteFacts', jsonb_strip_nulls(jsonb_build_object(
      'cms', cms,
      'siteBuilder', site_builder,
      'managedProvider', managed_provider,
      'agencyStatus', agency_status,
      'agencyName', agency_name
    ))
  ),
  cms = null,
  site_builder = null,
  managed_provider = null,
  agency_status = 'unknown',
  agency_name = null
where observation_kind <> 'business_website'
  and (
    cms is not null or site_builder is not null or managed_provider is not null
    or agency_name is not null or agency_status in ('confirmed', 'likely')
  );

alter table public.prospect_observations
  add constraint prospect_observations_google_facts_verified_check check (
    (review_rating is null and review_count is null and google_place_id is null)
    or (
      observation_kind = 'google_business_profile'
      and identity_match_status = 'verified'
      and identity_verification_level in ('google_verified', 'cross_source_verified')
    )
  ),
  add constraint prospect_observations_website_facts_kind_check check (
    (cms is null and site_builder is null and managed_provider is null and agency_name is null)
    or observation_kind = 'business_website'
  );

alter table public.prospect_observations
  add column location_id text,
  add column founded_year integer check (founded_year between 1700 and 2100),
  add constraint prospect_observations_location_fk
    foreign key (location_id, prospect_id)
    references public.prospect_locations(id, prospect_id) on delete restrict;

alter table public.prospect_people
  add column relationship_status text not null default 'unverified'
    check (relationship_status in ('confirmed', 'likely', 'unverified', 'conflicted'));

alter table public.prospect_people
  drop constraint prospect_people_contact_type_check,
  add constraint prospect_people_contact_type_check check (contact_type in (
    'business_general', 'owner', 'founder', 'principal', 'manager', 'marketing',
    'registered_agent', 'responsible_licensee', 'other'
  ));

create table public.prospect_person_observations (
  id text primary key,
  person_id text not null references public.prospect_people(id) on delete restrict,
  contact_type text not null check (contact_type in (
    'business_general', 'owner', 'founder', 'principal', 'manager', 'marketing',
    'registered_agent', 'responsible_licensee', 'other'
  )),
  role_title text,
  person_status text not null check (person_status in ('current', 'former', 'unknown')),
  relationship_status text not null check (relationship_status in ('confirmed', 'likely', 'unverified', 'conflicted')),
  source_type text not null check (source_type in (
    'manual_research', 'licensed_dataset', 'open_dataset', 'business_website',
    'public_listing', 'public_registry', 'owner_verified', 'import'
  )),
  source_provider text,
  source_url text,
  source_id text references public.prospect_sources(id) on delete restrict,
  source_run_id text,
  source_record_key text,
  observed_at timestamptz not null,
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (source_run_id, source_id)
    references public.prospect_source_runs(id, source_id) on delete restrict,
  check (relationship_status <> 'confirmed' or source_url is not null or source_type = 'owner_verified')
);

insert into public.prospect_person_observations (
  id, person_id, contact_type, role_title, person_status, relationship_status,
  source_type, source_provider, source_url, source_id, source_run_id,
  source_record_key, observed_at, evidence, created_at
)
select
  'prospect_person_observation_' || substr(encode(extensions.digest(
    person.id || ':' || person.source_type || ':' || coalesce(person.source_provider, '') || ':' ||
    coalesce(person.source_url, '') || ':' || person.observed_at::text,
    'sha256'
  ), 'hex'), 1, 32),
  person.id,
  person.contact_type,
  person.role_title,
  person.status,
  case person.verification_status
    when 'owner_verified' then 'confirmed'
    when 'public_source' then 'likely'
    else 'unverified'
  end,
  person.source_type,
  person.source_provider,
  person.source_url,
  person.source_id,
  person.source_run_id,
  person.source_record_key,
  person.observed_at,
  jsonb_build_object('legacyVerificationStatus', person.verification_status),
  person.created_at
from public.prospect_people person;

update public.prospect_people person
set relationship_status = observation.relationship_status
from public.prospect_person_observations observation
where observation.person_id = person.id;

alter table public.prospect_people
  drop column source_type,
  drop column source_provider,
  drop column source_url,
  drop column source_id,
  drop column source_run_id,
  drop column source_record_key,
  drop column verification_status,
  drop column observed_at;

create index prospect_person_observations_person_latest_idx
  on public.prospect_person_observations(person_id, observed_at desc, id desc);
create index prospect_person_observations_source_idx
  on public.prospect_person_observations(source_provider, observed_at desc)
  where source_provider is not null;

-- Ensure every legacy canonical address has a normalized location before the
-- duplicate prospect columns are removed.
insert into public.prospect_locations (
  id, prospect_id, canonical_key, kind, status, location_name, address_line_1,
  address_line_2, locality, region, postal_code, country_code, phone, is_primary,
  observed_at, created_at, updated_at
)
select
  'prospect_location_' || substr(encode(extensions.digest(prospect.id || ':primary', 'sha256'), 'hex'), 1, 32),
  prospect.id,
  'primary',
  'headquarters',
  'unknown',
  null,
  prospect.address_line_1,
  prospect.address_line_2,
  prospect.locality,
  prospect.region,
  prospect.postal_code,
  prospect.country_code,
  prospect.phone,
  true,
  prospect.updated_at,
  prospect.created_at,
  prospect.updated_at
from public.prospects prospect
where not exists (
  select 1 from public.prospect_locations location where location.prospect_id = prospect.id
)
and (
  prospect.address_line_1 is not null or prospect.locality is not null or
  prospect.region is not null or prospect.postal_code is not null or prospect.phone is not null
);

-- Google observations require a location anchor even when the source record did
-- not contain a usable street address.
insert into public.prospect_locations (
  id, prospect_id, canonical_key, kind, status, country_code, is_primary,
  observed_at, created_at, updated_at
)
select
  'prospect_location_' || substr(encode(extensions.digest(prospect.id || ':primary', 'sha256'), 'hex'), 1, 32),
  prospect.id, 'primary', 'unknown', 'unknown', 'US', true,
  min(observation.observed_at), min(observation.created_at), max(observation.created_at)
from public.prospects prospect
join public.prospect_observations observation on observation.prospect_id = prospect.id
  and observation.observation_kind = 'google_business_profile'
where not exists (
  select 1 from public.prospect_locations location where location.prospect_id = prospect.id
)
group by prospect.id;

with ranked_locations as (
  select location.id, location.prospect_id, location.is_primary,
    row_number() over (
      partition by location.prospect_id
      order by location.is_primary desc, location.observed_at desc, location.id
    ) as position
  from public.prospect_locations location
), prospects_without_primary as (
  select prospect_id from ranked_locations group by prospect_id
  having not bool_or(is_primary)
)
update public.prospect_locations location
set is_primary = true, updated_at = now()
from ranked_locations ranked
join prospects_without_primary missing on missing.prospect_id = ranked.prospect_id
where location.id = ranked.id and ranked.position = 1;

-- Normalize any remaining legacy top-level business phone into the contact model.
with normalized as (
  select prospect.id as prospect_id, prospect.phone as display_value,
    case
      when length(regexp_replace(prospect.phone, '\\D', '', 'g')) = 10
        then '+1' || regexp_replace(prospect.phone, '\\D', '', 'g')
      when length(regexp_replace(prospect.phone, '\\D', '', 'g')) = 11
        and regexp_replace(prospect.phone, '\\D', '', 'g') like '1%'
        then '+' || regexp_replace(prospect.phone, '\\D', '', 'g')
      else regexp_replace(prospect.phone, '\\s+', '', 'g')
    end as normalized_value,
    prospect.created_at, prospect.updated_at
  from public.prospects prospect where prospect.phone is not null
), retained as (
  insert into public.prospect_contact_points (
    id, prospect_id, kind, normalized_value, display_value, phone_type, status,
    is_preferred, outreach_eligible, created_at, updated_at
  )
  select
    'prospect_contact_point_' || substr(encode(extensions.digest(
      normalized.prospect_id || ':phone:' || normalized.normalized_value,
      'sha256'
    ), 'hex'), 1, 32),
    normalized.prospect_id, 'phone', normalized.normalized_value,
    normalized.display_value, 'main', 'active', false, false,
    normalized.created_at, normalized.updated_at
  from normalized
  where not exists (
    select 1 from public.prospect_contact_points point
    where point.prospect_id = normalized.prospect_id
      and point.kind = 'phone'
      and point.normalized_value = normalized.normalized_value
  )
  returning id, prospect_id, created_at
)
insert into public.prospect_contact_point_observations (
  id, contact_point_id, source_type, source_provider, verification_status,
  observed_at, evidence, created_at
)
select
  'prospect_contact_observation_' || substr(encode(extensions.digest(
    retained.id || ':legacy_prospect_record', 'sha256'
  ), 'hex'), 1, 32),
  retained.id, 'import', 'legacy_prospect_record', 'unverified', retained.created_at,
  jsonb_build_object('backfilledFrom', 'prospects.phone'), retained.created_at
from retained;

update public.prospect_observations observation
set location_id = coalesce(
  (
    select location.id from public.prospect_locations location
    where location.prospect_id = observation.prospect_id
      and observation.google_place_id is not null
      and location.google_place_id = observation.google_place_id
    order by location.is_primary desc, location.observed_at desc, location.id limit 1
  ),
  (
    select location.id from public.prospect_locations location
    where location.prospect_id = observation.prospect_id
    order by location.is_primary desc, location.observed_at desc, location.id limit 1
  )
)
where observation.observation_kind = 'google_business_profile';

update public.prospect_observations
set evidence = coalesce(evidence, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
  'legacyYearsInBusiness', years_in_business,
  'legacyTargetFitStatus', target_fit_status,
  'legacyTargetFitReason', target_fit_reason,
  'legacyScoring', case when scoring_model is not null or business_strength_score is not null
    or website_opportunity_score is not null or reachability_score is not null or priority_score is not null
    then jsonb_strip_nulls(jsonb_build_object(
      'model', scoring_model,
      'businessStrength', business_strength_score,
      'websiteOpportunity', website_opportunity_score,
      'reachability', reachability_score,
      'priority', priority_score
    )) else null end
));

alter table public.prospect_observations
  drop column years_in_business,
  drop column target_fit_status,
  drop column target_fit_reason,
  drop column business_strength_score,
  drop column website_opportunity_score,
  drop column reachability_score,
  drop column priority_score,
  drop column scoring_model,
  add constraint prospect_observations_verified_google_location_check check (
    observation_kind <> 'google_business_profile'
    or identity_match_status <> 'verified'
    or location_id is not null
  );

alter table public.prospects
  drop column address_line_1,
  drop column address_line_2,
  drop column locality,
  drop column region,
  drop column postal_code,
  drop column country_code,
  drop column phone;

create view public.prospect_contact_details
with (security_invoker = true)
as
select
  observation.id,
  point.id as contact_point_id,
  person.id as person_id,
  point.location_id,
  point.prospect_id,
  coalesce(person_observation.contact_type, person.contact_type, 'business_general') as contact_type,
  person.full_name,
  coalesce(person_observation.role_title, person.role_title) as role_title,
  coalesce(person_observation.relationship_status, person.relationship_status) as relationship_status,
  case when point.kind = 'email' then point.display_value end as email,
  case when point.kind = 'phone' then point.display_value end as phone,
  point.phone_type,
  point.extension,
  point.status,
  point.is_preferred,
  observation.source_type,
  observation.source_provider,
  observation.source_url,
  observation.source_id,
  observation.source_run_id,
  observation.source_record_key,
  observation.verification_status,
  point.outreach_eligible,
  observation.observed_at,
  bounds.first_observed_at,
  bounds.last_observed_at,
  observation.evidence,
  point.suppressed_at,
  point.suppression_reason,
  point.created_at,
  point.updated_at
from public.prospect_contact_points point
left join public.prospect_people person on person.id = point.person_id
left join lateral (
  select source.* from public.prospect_person_observations source
  where source.person_id = person.id
  order by source.observed_at desc, source.id desc limit 1
) person_observation on true
join public.prospect_contact_point_observations observation on observation.contact_point_id = point.id
join lateral (
  select min(source.observed_at) as first_observed_at, max(source.observed_at) as last_observed_at
  from public.prospect_contact_point_observations source
  where source.contact_point_id = point.id
) bounds on true
union all
select
  person_observation.id,
  null::text,
  person.id,
  person.location_id,
  person.prospect_id,
  person_observation.contact_type,
  person.full_name,
  coalesce(person_observation.role_title, person.role_title),
  person_observation.relationship_status,
  null::text,
  null::text,
  null::text,
  null::text,
  'active'::text,
  false,
  person_observation.source_type,
  person_observation.source_provider,
  person_observation.source_url,
  person_observation.source_id,
  person_observation.source_run_id,
  person_observation.source_record_key,
  case person_observation.relationship_status
    when 'confirmed' then 'owner_verified'
    when 'likely' then 'public_source'
    else 'unverified'
  end,
  false,
  person_observation.observed_at,
  bounds.first_observed_at,
  bounds.last_observed_at,
  person_observation.evidence,
  null::timestamptz,
  null::text,
  person.created_at,
  person.updated_at
from public.prospect_people person
join lateral (
  select source.* from public.prospect_person_observations source
  where source.person_id = person.id
  order by source.observed_at desc, source.id desc limit 1
) person_observation on true
join lateral (
  select min(source.observed_at) as first_observed_at, max(source.observed_at) as last_observed_at
  from public.prospect_person_observations source where source.person_id = person.id
) bounds on true
where not exists (select 1 from public.prospect_contact_points point where point.person_id = person.id);

create view public.prospect_current
with (security_invoker = true)
as
select
  prospect.id, prospect.canonical_key, prospect.business_name, prospect.legal_business_name, prospect.dba_name,
  prospect.vertical, prospect.industry_code, prospect.market, prospect.ownership_scope,
  prospect.location_research_status, prospect.eligibility_status, prospect.disqualification_reason,
  prospect.eligibility_reason, prospect.eligibility_policy_version, prospect.eligibility_source,
  prospect.eligibility_assessed_at, prospect.status, prospect.website_kind, prospect.website_url,
  prospect.website_host,
  primary_location.address_line_1, primary_location.address_line_2, primary_location.locality,
  primary_location.region, primary_location.postal_code, primary_location.country_code,
  prospect.do_not_contact, prospect.suppression_reason, prospect.metadata,
  prospect.created_at, prospect.updated_at,
  latest_observation.id as latest_observation_id, latest_observation.observed_at as latest_observed_at,
  google_observation.review_rating as google_rating, google_observation.review_count as google_review_count,
  google_location.google_place_id,
  identity_observation.identity_match_status, identity_observation.identity_verification_level,
  founded_observation.founded_year,
  coalesce(website_observation.site_builder, website_observation.cms) as website_platform,
  coalesce(website_observation.agency_name, website_observation.managed_provider) as website_provider,
  coalesce(google_observation.operating_status, identity_observation.operating_status) as operating_status,
  organization.name as brand_name, membership.confidence as brand_confidence,
  contacts.owner_name, contacts.public_email, contacts.public_phone,
  coalesce(contacts.contact_details, '[]'::jsonb) as contact_details,
  coalesce(contacts.contact_count, 0)::integer as contact_count,
  coalesce(locations.location_count, 0)::integer as location_count,
  coalesce(licenses.active_license_count, 0)::integer as active_license_count
from public.prospects prospect
left join lateral (
  select location.* from public.prospect_locations location
  where location.prospect_id = prospect.id and location.status <> 'inactive'
  order by location.is_primary desc, location.observed_at desc, location.id limit 1
) primary_location on true
left join lateral (
  select observation.* from public.prospect_observations observation
  where observation.prospect_id = prospect.id
  order by observation.observed_at desc, observation.id desc limit 1
) latest_observation on true
left join lateral (
  select observation.* from public.prospect_observations observation
  where observation.prospect_id = prospect.id and observation.identity_match_status = 'verified'
  order by case observation.identity_verification_level
    when 'cross_source_verified' then 3 when 'website_verified' then 2
    when 'google_verified' then 1 else 0 end desc,
    observation.observed_at desc, observation.id desc limit 1
) identity_observation on true
left join lateral (
  select observation.* from public.prospect_observations observation
  where observation.prospect_id = prospect.id
    and observation.observation_kind = 'google_business_profile'
    and observation.identity_match_status = 'verified'
    and observation.identity_verification_level in ('google_verified', 'cross_source_verified')
  order by observation.observed_at desc, observation.id desc limit 1
) google_observation on true
left join public.prospect_locations google_location on google_location.id = google_observation.location_id
left join lateral (
  select observation.* from public.prospect_observations observation
  where observation.prospect_id = prospect.id
    and observation.observation_kind = 'business_website'
    and observation.identity_match_status = 'verified'
    and observation.identity_verification_level in ('website_verified', 'cross_source_verified')
  order by observation.observed_at desc, observation.id desc limit 1
) website_observation on true
left join lateral (
  select observation.* from public.prospect_observations observation
  where observation.prospect_id = prospect.id and observation.founded_year is not null
  order by observation.observed_at desc, observation.id desc limit 1
) founded_observation on true
left join lateral (
  select membership.* from public.prospect_organization_memberships membership
  where membership.prospect_id = prospect.id
    and membership.relationship in ('company_owned_location', 'franchisee', 'subsidiary', 'operates_brand')
  order by membership.observed_at desc, membership.id desc limit 1
) membership on true
left join public.prospect_organization_groups organization on organization.id = membership.group_id
left join lateral (
  select
    (array_agg(contact.full_name order by
      case contact.relationship_status when 'confirmed' then 2 when 'likely' then 1 else 0 end desc,
      contact.last_observed_at desc) filter (
      where contact.contact_type in ('owner', 'founder', 'principal')
        and contact.relationship_status in ('confirmed', 'likely') and contact.suppressed_at is null
    ))[1] as owner_name,
    (array_agg(contact.email order by contact.is_preferred desc, contact.last_observed_at desc) filter (
      where contact.outreach_eligible and contact.email is not null and contact.status = 'active'
        and contact.suppressed_at is null and not prospect.do_not_contact
    ))[1] as public_email,
    (array_agg(contact.phone order by contact.is_preferred desc, contact.last_observed_at desc) filter (
      where contact.outreach_eligible and contact.phone is not null and contact.status = 'active'
        and contact.suppressed_at is null and not prospect.do_not_contact
    ))[1] as public_phone,
    jsonb_agg(jsonb_build_object(
      'id', contact.id, 'contactPointId', contact.contact_point_id, 'personId', contact.person_id,
      'locationId', contact.location_id, 'contactType', contact.contact_type,
      'relationshipStatus', contact.relationship_status,
      'fullName', contact.full_name, 'roleTitle', contact.role_title,
      'email', contact.email, 'phone', contact.phone, 'phoneType', contact.phone_type,
      'extension', contact.extension, 'status', contact.status, 'isPreferred', contact.is_preferred,
      'sourceType', contact.source_type, 'sourceProvider', contact.source_provider,
      'sourceUrl', contact.source_url, 'verificationStatus', contact.verification_status,
      'outreachEligible', contact.outreach_eligible, 'observedAt', contact.observed_at,
      'firstObservedAt', contact.first_observed_at, 'lastObservedAt', contact.last_observed_at
    ) order by contact.last_observed_at desc, contact.id desc)
      filter (where contact.suppressed_at is null) as contact_details,
    count(distinct contact.contact_point_id)
      filter (where contact.contact_point_id is not null and contact.suppressed_at is null)
      + count(*) filter (where contact.contact_point_id is null) as contact_count
  from public.prospect_contact_details contact where contact.prospect_id = prospect.id
) contacts on true
left join lateral (
  select count(*) as location_count from public.prospect_locations location
  where location.prospect_id = prospect.id and location.status <> 'inactive'
) locations on true
left join lateral (
  select count(*) as active_license_count from public.prospect_licenses license
  where license.prospect_id = prospect.id and license.status = 'active'
) licenses on true;

alter table public.prospect_person_observations enable row level security;
revoke all on table public.prospect_person_observations from public, anon, authenticated;
grant select, insert on table public.prospect_person_observations to service_role;
grant select on table public.prospect_contact_details, public.prospect_current to service_role;

commit;
