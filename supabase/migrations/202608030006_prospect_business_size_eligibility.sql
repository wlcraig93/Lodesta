-- Keep independent business structure separate from the current Lodesta ICP policy.
-- One through five retained active locations remain eligible by size; six or more
-- locations are regional independents and are excluded from the initial target.

begin;

alter table public.prospects
  drop constraint prospects_disqualification_reason_check,
  add constraint prospects_disqualification_reason_check check (
    disqualification_reason in (
      'national_corporate_chain',
      'franchise',
      'institutional_or_government',
      'supplier_or_retailer',
      'outside_target_industry',
      'outside_target_market',
      'outside_target_business_size',
      'permanently_closed',
      'duplicate_record',
      'invalid_business_identity',
      'manual_exclusion'
    )
  );

alter table public.prospect_organization_groups
  drop constraint prospect_organization_groups_default_disqualification_rea_check,
  add constraint prospect_organization_groups_default_disqualification_rea_check check (
    default_disqualification_reason in (
      'national_corporate_chain',
      'franchise',
      'institutional_or_government',
      'supplier_or_retailer',
      'outside_target_industry',
      'outside_target_market',
      'outside_target_business_size',
      'permanently_closed',
      'duplicate_record',
      'invalid_business_identity',
      'manual_exclusion'
    )
  );

with imported_regional_location_counts as (
  select
    prospect.id,
    count(location.id) filter (where location.status <> 'inactive')::integer as active_location_count
  from public.prospects prospect
  left join public.prospect_locations location on location.prospect_id = prospect.id
  where prospect.ownership_scope = 'regional_independent'
    and prospect.metadata ? 'acquisitionSource'
  group by prospect.id
)
update public.prospects prospect
set
  ownership_scope = case
    when location_count.active_location_count = 1 then 'independent_single_location'
    else 'independent_multi_location'
  end,
  updated_at = now()
from imported_regional_location_counts location_count
where prospect.id = location_count.id
  and location_count.active_location_count between 1 and 5;

with imported_regional_location_counts as (
  select
    prospect.id,
    count(location.id) filter (where location.status <> 'inactive')::integer as active_location_count
  from public.prospects prospect
  left join public.prospect_locations location on location.prospect_id = prospect.id
  where prospect.ownership_scope = 'regional_independent'
    and prospect.metadata ? 'acquisitionSource'
  group by prospect.id
)
update public.prospects prospect
set
  eligibility_status = 'disqualified',
  disqualification_reason = 'outside_target_business_size',
  eligibility_reason = 'Known six-or-more-location regional operator is outside Lodesta''s initial business-size target.',
  eligibility_policy_version = 'lodesta-icp-v2',
  eligibility_source = 'automated_rule',
  eligibility_assessed_at = now(),
  updated_at = now()
from imported_regional_location_counts location_count
where prospect.id = location_count.id
  and location_count.active_location_count >= 6
  and prospect.eligibility_status <> 'disqualified';

do $$
begin
  if exists (
    select 1
    from public.prospects prospect
    join lateral (
      select count(*)::integer as active_location_count
      from public.prospect_locations location
      where location.prospect_id = prospect.id
        and location.status <> 'inactive'
    ) location_count on true
    where prospect.ownership_scope = 'regional_independent'
      and prospect.metadata ? 'acquisitionSource'
      and location_count.active_location_count between 1 and 5
  ) then
    raise exception 'Imported one-to-five-location businesses remain classified as regional independents.';
  end if;

  if exists (
    select 1
    from public.prospects prospect
    join lateral (
      select count(*)::integer as active_location_count
      from public.prospect_locations location
      where location.prospect_id = prospect.id
        and location.status <> 'inactive'
    ) location_count on true
    where prospect.ownership_scope = 'regional_independent'
      and prospect.metadata ? 'acquisitionSource'
      and location_count.active_location_count >= 6
      and prospect.eligibility_status <> 'disqualified'
  ) then
    raise exception 'Imported six-or-more-location regional businesses remain eligible.';
  end if;
end $$;

commit;
