-- Keep is a terminal, evidence-backed research disposition. Any prior
-- provisional "eligible" row that does not satisfy the exact-location Google
-- identity and Lodesta ICP invariants returns to review; no prospect is deleted.

update public.prospects as prospect
set
  eligibility_status = 'review_required',
  disqualification_reason = null,
  eligibility_reason = 'Previous Keep assessment reset: exact Google Place identity, operating status, independent ownership, and the complete one-to-five-location footprint must all be confirmed.',
  eligibility_policy_version = 'lodesta-icp-v3',
  eligibility_source = 'automated_rule',
  eligibility_assessed_at = now(),
  metadata = coalesce(prospect.metadata, '{}'::jsonb) || jsonb_build_object(
    'triageDisposition', 'review',
    'dispositionCutover', 'verified-place-prospect-disposition-v1'
  )
where prospect.eligibility_status = 'eligible'
  and not (
    prospect.status = 'active'
    and prospect.ownership_scope in ('independent_single_location', 'independent_multi_location')
    and prospect.location_research_status = 'confirmed_complete'
    and exists (
      select 1
      from public.prospect_locations as location
      join public.prospect_observations as observation
        on observation.prospect_id = prospect.id
       and observation.location_id = location.id
       and observation.observation_kind = 'google_business_profile'
       and observation.identity_match_status = 'verified'
       and observation.identity_verification_level in ('google_verified', 'cross_source_verified')
       and observation.operating_status = 'operational'
       and observation.google_place_id = location.google_place_id
       and observation.evidence #>> '{placeIdLookup,status}' = 'found'
       and observation.evidence #>> '{placeIdLookup,googlePlaceId}' = location.google_place_id
      where location.prospect_id = prospect.id
        and location.status <> 'inactive'
        and location.google_place_id is not null
    )
  );

update public.prospects as prospect
set
  eligibility_policy_version = 'lodesta-icp-v3',
  metadata = coalesce(prospect.metadata, '{}'::jsonb) || jsonb_build_object(
    'triageDisposition', case prospect.eligibility_status
      when 'eligible' then 'keep'
      when 'disqualified' then 'delete_candidate'
      else 'review'
    end,
    'dispositionCutover', 'verified-place-prospect-disposition-v1'
  )
where prospect.eligibility_status <> 'unassessed';

comment on column public.prospects.eligibility_status is
  'Canonical prospect disposition: eligible=Keep, review_required or unassessed=Review, disqualified=Delete candidate. Keep requires an exact verified operational Google Place ID plus a confirmed independent one-to-five-location footprint.';
