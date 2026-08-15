-- Make prospect identity verification surface-aware and enforce the same
-- explainable cross-source policy at the database boundary.

begin;

drop view if exists public.prospect_current;

alter table public.prospect_observations
  add column identity_verification_level text not null default 'unverified'
    check (identity_verification_level in (
      'unverified', 'google_verified', 'website_verified', 'cross_source_verified'
    ));

create or replace function public.prospect_identity_basis_is_valid(
  match_status text,
  verification_level text,
  basis jsonb
)
returns boolean
language plpgsql
immutable
as $$
declare
  signal jsonb;
  conflict jsonb;
  family_count integer;
  connected text[] := array['registry_identity'];
  left_surface text;
  right_surface text;
  changed boolean := true;
begin
  if match_status <> 'verified' then
    return verification_level = 'unverified';
  end if;
  if verification_level = 'unverified'
    or basis->>'nameMatch' not in ('exact', 'compatible')
    or jsonb_typeof(basis->'corroboratingSignals') <> 'array'
    or jsonb_typeof(basis->'conflicts') <> 'array' then
    return false;
  end if;

  select count(distinct case
    when value->>'field' in ('website_host', 'business_email_domain') then 'domain'
    else value->>'field'
  end)
  into family_count
  from jsonb_array_elements(basis->'corroboratingSignals');
  if family_count < 2 then return false; end if;

  for signal in select value from jsonb_array_elements(basis->'corroboratingSignals') loop
    if signal->>'field' not in (
      'phone', 'address', 'website_host', 'business_email_domain', 'explicit_dba_link', 'responsible_person'
    )
      or signal->>'result' not in ('exact', 'compatible')
      or jsonb_typeof(signal->'surfaces') <> 'array'
      or jsonb_array_length(signal->'surfaces') <> 2 then
      return false;
    end if;
    left_surface := signal->'surfaces'->>0;
    right_surface := signal->'surfaces'->>1;
    if left_surface = right_surface
      or left_surface not in ('registry_identity', 'google_business_profile', 'business_website', 'public_directory')
      or right_surface not in ('registry_identity', 'google_business_profile', 'business_website', 'public_directory') then
      return false;
    end if;
  end loop;

  for conflict in select value from jsonb_array_elements(basis->'conflicts') loop
    if conflict->>'disposition' <> 'explained_stale'
      or nullif(btrim(conflict->>'explanation'), '') is null then
      return false;
    end if;
  end loop;

  while changed loop
    changed := false;
    for signal in select value from jsonb_array_elements(basis->'corroboratingSignals') loop
      left_surface := signal->'surfaces'->>0;
      right_surface := signal->'surfaces'->>1;
      if left_surface = any(connected) and not right_surface = any(connected) then
        connected := array_append(connected, right_surface);
        changed := true;
      elsif right_surface = any(connected) and not left_surface = any(connected) then
        connected := array_append(connected, left_surface);
        changed := true;
      end if;
    end loop;
  end loop;

  return case verification_level
    when 'google_verified' then 'google_business_profile' = any(connected)
    when 'website_verified' then 'business_website' = any(connected)
    when 'cross_source_verified' then
      'google_business_profile' = any(connected) and 'business_website' = any(connected)
    else false
  end;
end;
$$;

alter table public.prospect_observations
  add constraint prospect_observations_identity_verification_valid_check check (
    public.prospect_identity_basis_is_valid(
      identity_match_status,
      identity_verification_level,
      identity_match_basis
    )
  ),
  add constraint prospect_observations_verified_surface_kind_check check (
    identity_match_status <> 'verified'
    or observation_kind = 'research_summary'
    or (observation_kind = 'google_business_profile'
      and identity_verification_level in ('google_verified', 'cross_source_verified'))
    or (observation_kind = 'business_website'
      and identity_verification_level in ('website_verified', 'cross_source_verified'))
    or observation_kind in ('registry_identity', 'public_directory')
  ),
  add constraint prospect_observations_google_facts_verified_check check (
    (review_rating is null and review_count is null and google_place_id is null)
    or (
      observation_kind = 'google_business_profile'
      and identity_match_status = 'verified'
      and identity_verification_level in ('google_verified', 'cross_source_verified')
    )
  ) not valid,
  add constraint prospect_observations_website_facts_kind_check check (
    (cms is null and site_builder is null and managed_provider is null and agency_name is null)
    or observation_kind = 'business_website'
  ) not valid;

create index prospect_observations_identity_verification_idx
  on public.prospect_observations(identity_verification_level, identity_match_status, observed_at desc);

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
  google_observation.google_place_id, identity_observation.identity_match_status,
  identity_observation.identity_verification_level,
  years_observation.years_in_business,
  coalesce(website_observation.site_builder, website_observation.cms) as website_platform,
  coalesce(website_observation.agency_name, website_observation.managed_provider) as website_provider,
  coalesce(google_observation.operating_status, identity_observation.operating_status) as operating_status,
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
  where observation.prospect_id = prospect.id and observation.identity_match_status = 'verified'
  order by
    case observation.identity_verification_level
      when 'cross_source_verified' then 3
      when 'website_verified' then 2
      when 'google_verified' then 1
      else 0
    end desc,
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
  select count(*) as location_count
  from public.prospect_locations location where location.prospect_id = prospect.id and location.status <> 'inactive'
) locations on true
left join lateral (
  select count(*) as active_license_count from public.prospect_licenses license
  where license.prospect_id = prospect.id and license.status = 'active'
) licenses on true;

grant select on table public.prospect_current to service_role;

commit;
