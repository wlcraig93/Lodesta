-- Replace opaque prospect verification scores with explainable identity evidence,
-- preserve each research surface as its own observation, and distinguish a known
-- location inventory from a completed location-footprint assessment.

begin;

drop view if exists public.prospect_current;

alter table public.prospects
  add column location_research_status text not null default 'unresearched'
    check (location_research_status in ('unresearched', 'minimum_known', 'confirmed_complete'));

alter table public.prospects
  drop constraint prospects_eligibility_source_check,
  add constraint prospects_eligibility_source_check check (
    eligibility_source in ('automated_rule', 'agent_research', 'human_review', 'import', 'legacy_backfill')
  );

drop index if exists public.prospect_observations_verification_filters_idx;

alter table public.prospect_observations
  rename column verification_status to identity_match_status;

update public.prospect_observations
set
  evidence = coalesce(evidence, '{}'::jsonb) || jsonb_build_object(
    'legacyIdentityMatchStatus', identity_match_status,
    'legacyIdentityMatchPolicyVersion', 'legacy-prospect-identity-v0'
  ),
  identity_match_status = 'unverified';

alter table public.prospect_observations
  drop column verification_score,
  drop column evidence_coverage,
  add column observation_kind text,
  add column identity_match_policy_version text,
  add column identity_match_basis jsonb,
  add column google_business_name text,
  add column google_category text,
  add column google_address text,
  add column google_phone text,
  add column google_website_url text,
  add column google_maps_url text,
  add column google_place_id text;

update public.prospect_observations
set
  observation_kind = case
    when source_provider = 'google_business_profile' then 'google_business_profile'
    when source_type = 'business_website' then 'business_website'
    when source_type in ('licensed_dataset', 'open_dataset', 'public_registry', 'import') then 'registry_identity'
    when source_type = 'public_listing' then 'public_directory'
    else 'research_summary'
  end,
  identity_match_policy_version = 'legacy-prospect-identity-v0',
  google_maps_url = case
    when source_provider = 'google_business_profile' then source_url
    else null
  end,
  identity_match_basis = jsonb_build_object(
    'nameMatch', 'unknown',
    'corroboratingSignals', '[]'::jsonb,
    'conflicts', '[]'::jsonb
  );

alter table public.prospect_observations
  alter column observation_kind set not null,
  alter column identity_match_policy_version set not null,
  alter column identity_match_basis set not null,
  add constraint prospect_observations_observation_kind_check check (
    observation_kind in ('registry_identity', 'google_business_profile', 'business_website', 'public_directory', 'research_summary')
  ),
  add constraint prospect_observations_identity_match_basis_object_check check (
    jsonb_typeof(identity_match_basis) = 'object'
  ),
  add constraint prospect_observations_google_place_id_kind_check check (
    google_place_id is null or observation_kind = 'google_business_profile'
  ),
  add constraint prospect_observations_google_place_id_shape_check check (
    google_place_id is null or char_length(google_place_id) between 10 and 255
  );

create index prospect_observations_identity_filters_idx
  on public.prospect_observations(identity_match_status, observation_kind, operating_status, observed_at desc);

create view public.prospect_current
with (security_invoker = true)
as
select
  prospect.id, prospect.canonical_key, prospect.business_name, prospect.legal_business_name, prospect.dba_name,
  prospect.vertical, prospect.industry_code, prospect.market, prospect.ownership_scope,
  prospect.location_research_status, prospect.eligibility_status, prospect.disqualification_reason,
  prospect.eligibility_reason, prospect.eligibility_policy_version, prospect.eligibility_source,
  prospect.eligibility_assessed_at, prospect.status, prospect.website_kind, prospect.website_url,
  prospect.website_host, prospect.address_line_1, prospect.address_line_2, prospect.locality,
  prospect.region, prospect.postal_code, prospect.country_code, prospect.phone, prospect.do_not_contact,
  prospect.suppression_reason, prospect.metadata, prospect.created_at, prospect.updated_at,
  latest_observation.id as latest_observation_id, latest_observation.observed_at as latest_observed_at,
  google_observation.review_rating as google_rating, google_observation.review_count as google_review_count,
  locations.google_place_id, google_observation.identity_match_status,
  years_observation.years_in_business,
  coalesce(website_observation.site_builder, website_observation.cms) as website_platform,
  coalesce(website_observation.agency_name, website_observation.managed_provider) as website_provider,
  coalesce(google_observation.operating_status, latest_observation.operating_status) as operating_status,
  organization.name as brand_name, membership.confidence as brand_confidence,
  contacts.owner_name, contacts.public_email,
  coalesce(contacts.public_phone, case when not prospect.do_not_contact then prospect.phone end) as public_phone,
  coalesce(contacts.contact_details, '[]'::jsonb) as contact_details,
  coalesce(contacts.contact_count, 0)::integer as contact_count,
  coalesce(locations.location_count, 0)::integer as location_count,
  coalesce(licenses.active_license_count, 0)::integer as active_license_count
from public.prospects prospect
left join lateral (
  select observation.* from public.prospect_observations observation
  where observation.prospect_id = prospect.id
  order by observation.observed_at desc, observation.id desc limit 1
) latest_observation on true
left join lateral (
  select observation.* from public.prospect_observations observation
  where observation.prospect_id = prospect.id
    and observation.observation_kind = 'google_business_profile'
    and observation.identity_match_status = 'verified'
  order by observation.observed_at desc, observation.id desc limit 1
) google_observation on true
left join lateral (
  select observation.* from public.prospect_observations observation
  where observation.prospect_id = prospect.id and observation.observation_kind = 'business_website'
  order by observation.observed_at desc, observation.id desc limit 1
) website_observation on true
left join lateral (
  select observation.* from public.prospect_observations observation
  where observation.prospect_id = prospect.id and observation.years_in_business is not null
  order by observation.observed_at desc, observation.id desc limit 1
) years_observation on true
left join lateral (
  select membership.* from public.prospect_organization_memberships membership
  where membership.prospect_id = prospect.id
    and membership.relationship in ('company_owned_location', 'franchisee', 'subsidiary', 'operates_brand')
  order by membership.observed_at desc, membership.id desc limit 1
) membership on true
left join public.prospect_organization_groups organization on organization.id = membership.group_id
left join lateral (
  select
    (array_agg(contact.full_name order by contact.last_observed_at desc) filter (
      where contact.contact_type = 'owner' and contact.verification_status in ('public_source', 'owner_verified')
        and contact.suppressed_at is null
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
      'locationId', contact.location_id, 'contactType', contact.contact_type, 'fullName', contact.full_name,
      'roleTitle', contact.role_title, 'email', contact.email, 'phone', contact.phone,
      'phoneType', contact.phone_type, 'extension', contact.extension, 'status', contact.status,
      'isPreferred', contact.is_preferred, 'sourceType', contact.source_type,
      'sourceProvider', contact.source_provider, 'sourceUrl', contact.source_url,
      'verificationStatus', contact.verification_status, 'outreachEligible', contact.outreach_eligible,
      'observedAt', contact.observed_at, 'firstObservedAt', contact.first_observed_at,
      'lastObservedAt', contact.last_observed_at
    ) order by contact.last_observed_at desc, contact.id desc) filter (where contact.suppressed_at is null) as contact_details,
    count(distinct contact.contact_point_id) filter (where contact.contact_point_id is not null and contact.suppressed_at is null)
      + count(*) filter (where contact.contact_point_id is null) as contact_count
  from public.prospect_contact_details contact where contact.prospect_id = prospect.id
) contacts on true
left join lateral (
  select count(*) as location_count,
    (array_agg(location.google_place_id order by location.is_primary desc, location.observed_at desc, location.id desc)
      filter (where location.google_place_id is not null))[1] as google_place_id
  from public.prospect_locations location where location.prospect_id = prospect.id and location.status <> 'inactive'
) locations on true
left join lateral (
  select count(*) as active_license_count from public.prospect_licenses license
  where license.prospect_id = prospect.id and license.status = 'active'
) licenses on true;

grant select on table public.prospect_current to service_role;

commit;
