alter table public.prospects
  add column market text,
  add column eligibility_status text not null default 'unassessed'
    check (eligibility_status in ('unassessed', 'eligible', 'review_required', 'disqualified')),
  add column disqualification_reason text
    check (disqualification_reason in (
      'national_corporate_chain',
      'franchise',
      'institutional_or_government',
      'supplier_or_retailer',
      'outside_target_industry',
      'outside_target_market',
      'permanently_closed',
      'duplicate_record',
      'invalid_business_identity',
      'manual_exclusion'
    )),
  add column eligibility_reason text,
  add column eligibility_policy_version text,
  add column eligibility_source text
    check (eligibility_source in ('automated_rule', 'human_review', 'import', 'legacy_backfill')),
  add column eligibility_assessed_at timestamptz,
  add constraint prospects_disqualification_reason_consistency check (
    (eligibility_status = 'disqualified' and disqualification_reason is not null)
    or (eligibility_status <> 'disqualified' and disqualification_reason is null)
  );

alter table public.prospect_locations
  add column google_place_id text
    check (google_place_id is null or char_length(google_place_id) between 10 and 255);

drop index if exists public.prospect_contacts_email_unique;
drop index if exists public.prospect_contacts_phone_unique;

update public.prospects
set phone = case
  when char_length(regexp_replace(phone, '[^0-9]', '', 'g')) = 10 then '+1' || regexp_replace(phone, '[^0-9]', '', 'g')
  when char_length(regexp_replace(phone, '[^0-9]', '', 'g')) = 11 and regexp_replace(phone, '[^0-9]', '', 'g') like '1%' then '+' || regexp_replace(phone, '[^0-9]', '', 'g')
  when phone like '+%' and char_length(regexp_replace(phone, '[^0-9]', '', 'g')) between 8 and 15 then '+' || regexp_replace(phone, '[^0-9]', '', 'g')
  else btrim(phone)
end
where phone is not null;

update public.prospect_locations
set phone = case
  when char_length(regexp_replace(phone, '[^0-9]', '', 'g')) = 10 then '+1' || regexp_replace(phone, '[^0-9]', '', 'g')
  when char_length(regexp_replace(phone, '[^0-9]', '', 'g')) = 11 and regexp_replace(phone, '[^0-9]', '', 'g') like '1%' then '+' || regexp_replace(phone, '[^0-9]', '', 'g')
  when phone like '+%' and char_length(regexp_replace(phone, '[^0-9]', '', 'g')) between 8 and 15 then '+' || regexp_replace(phone, '[^0-9]', '', 'g')
  else btrim(phone)
end
where phone is not null;

update public.prospect_contacts
set phone = case
  when char_length(regexp_replace(phone, '[^0-9]', '', 'g')) = 10 then '+1' || regexp_replace(phone, '[^0-9]', '', 'g')
  when char_length(regexp_replace(phone, '[^0-9]', '', 'g')) = 11 and regexp_replace(phone, '[^0-9]', '', 'g') like '1%' then '+' || regexp_replace(phone, '[^0-9]', '', 'g')
  when phone like '+%' and char_length(regexp_replace(phone, '[^0-9]', '', 'g')) between 8 and 15 then '+' || regexp_replace(phone, '[^0-9]', '', 'g')
  else btrim(phone)
end
where phone is not null;

with best_location as (
  select distinct on (location.prospect_id)
    location.id,
    location.prospect_id
  from public.prospect_locations location
  where location.status <> 'inactive'
  order by location.prospect_id, location.is_primary desc, location.observed_at desc, location.id desc
)
update public.prospect_locations location
set google_place_id = prospect.metadata->>'googlePlaceId'
from best_location selected
join public.prospects prospect on prospect.id = selected.prospect_id
where location.id = selected.id
  and nullif(prospect.metadata->>'googlePlaceId', '') is not null;

with latest_observation as (
  select distinct on (observation.prospect_id)
    observation.prospect_id,
    observation.target_fit_status,
    observation.target_fit_reason,
    observation.operating_status,
    observation.observed_at
  from public.prospect_observations observation
  order by observation.prospect_id, observation.observed_at desc, observation.id desc
)
update public.prospects prospect
set
  eligibility_status = case
    when prospect.ownership_scope in ('corporate_chain', 'franchisee') then 'disqualified'
    when latest.operating_status = 'permanently_closed' then 'disqualified'
    when latest.target_fit_status = 'excluded' then 'disqualified'
    when latest.target_fit_status = 'target' then 'eligible'
    when latest.target_fit_status = 'review_required' then 'review_required'
    else 'unassessed'
  end,
  disqualification_reason = case
    when prospect.ownership_scope = 'corporate_chain' then 'national_corporate_chain'
    when prospect.ownership_scope = 'franchisee' then 'franchise'
    when latest.operating_status = 'permanently_closed' then 'permanently_closed'
    when latest.target_fit_status = 'excluded' and lower(coalesce(latest.target_fit_reason, '')) similar to '%(chain|corporate|national brand|orkin)%' then 'national_corporate_chain'
    when latest.target_fit_status = 'excluded' and lower(coalesce(latest.target_fit_reason, '')) like '%franchise%' then 'franchise'
    when latest.target_fit_status = 'excluded' and lower(coalesce(latest.target_fit_reason, '')) similar to '%(government|institution|university|municipal)%' then 'institutional_or_government'
    when latest.target_fit_status = 'excluded' and lower(coalesce(latest.target_fit_reason, '')) similar to '%(supplier|retailer|wholesale)%' then 'supplier_or_retailer'
    when latest.target_fit_status = 'excluded' then 'manual_exclusion'
    else null
  end,
  eligibility_reason = latest.target_fit_reason,
  eligibility_policy_version = case when latest.prospect_id is not null or prospect.ownership_scope <> 'unknown' then 'lodesta-icp-v1' else null end,
  eligibility_source = case when latest.prospect_id is not null or prospect.ownership_scope <> 'unknown' then 'legacy_backfill' else null end,
  eligibility_assessed_at = case when latest.prospect_id is not null or prospect.ownership_scope <> 'unknown' then coalesce(latest.observed_at, prospect.updated_at) else null end
from latest_observation latest
where latest.prospect_id = prospect.id;

update public.prospects
set
  eligibility_status = 'disqualified',
  disqualification_reason = case when ownership_scope = 'franchisee' then 'franchise' else 'national_corporate_chain' end,
  eligibility_reason = coalesce(eligibility_reason, 'Ownership structure is outside Lodesta''s independent-business target.'),
  eligibility_policy_version = coalesce(eligibility_policy_version, 'lodesta-icp-v1'),
  eligibility_source = coalesce(eligibility_source, 'legacy_backfill'),
  eligibility_assessed_at = coalesce(eligibility_assessed_at, updated_at)
where ownership_scope in ('corporate_chain', 'franchisee')
  and eligibility_status <> 'disqualified';

alter table public.prospects
  add constraint prospects_eligibility_provenance check (
    eligibility_status = 'unassessed'
    or (
      eligibility_policy_version is not null
      and eligibility_source is not null
      and eligibility_assessed_at is not null
    )
  );

create index prospects_eligibility_idx
  on public.prospects (eligibility_status, disqualification_reason, vertical);
create index prospects_market_idx
  on public.prospects (market)
  where market is not null;
create index prospect_locations_google_place_id_idx
  on public.prospect_locations (google_place_id)
  where google_place_id is not null;
create index prospect_contacts_email_source_idx
  on public.prospect_contacts (prospect_id, lower(email), source_type)
  where email is not null and suppressed_at is null;
create index prospect_contacts_phone_source_idx
  on public.prospect_contacts (prospect_id, phone, source_type)
  where phone is not null and suppressed_at is null;

drop view public.prospect_current;

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
  prospect.market,
  prospect.ownership_scope,
  prospect.eligibility_status,
  prospect.disqualification_reason,
  prospect.eligibility_reason,
  prospect.eligibility_policy_version,
  prospect.eligibility_source,
  prospect.eligibility_assessed_at,
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
  observation.review_rating as google_rating,
  observation.review_count as google_review_count,
  locations.google_place_id,
  observation.years_in_business,
  coalesce(observation.site_builder, observation.cms) as website_platform,
  coalesce(observation.agency_name, observation.managed_provider) as website_provider,
  observation.operating_status,
  brand.related_organization_name as brand_name,
  brand.confidence as brand_confidence,
  contacts.owner_name,
  contacts.public_email,
  coalesce(contacts.public_phone, case when not prospect.do_not_contact then prospect.phone end) as public_phone,
  coalesce(contacts.contact_details, '[]'::jsonb) as contact_details,
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
  select current_affiliation.*
  from public.prospect_affiliations current_affiliation
  where current_affiliation.prospect_id = prospect.id
    and current_affiliation.affiliation_type in ('franchisee_of', 'operates_brand', 'subsidiary_of')
  order by current_affiliation.observed_at desc, current_affiliation.id desc
  limit 1
) brand on true
left join lateral (
  select
    (array_agg(contact.full_name order by contact.observed_at desc) filter (
      where contact.contact_type = 'owner'
        and contact.verification_status in ('public_source', 'owner_verified')
        and contact.suppressed_at is null
    ))[1] as owner_name,
    (array_agg(contact.email order by contact.observed_at desc) filter (
      where contact.outreach_eligible
        and contact.email is not null
        and contact.suppressed_at is null
        and not prospect.do_not_contact
    ))[1] as public_email,
    (array_agg(contact.phone order by contact.observed_at desc) filter (
      where contact.outreach_eligible
        and contact.phone is not null
        and contact.suppressed_at is null
        and not prospect.do_not_contact
    ))[1] as public_phone,
    jsonb_agg(
      jsonb_build_object(
        'id', contact.id,
        'contactType', contact.contact_type,
        'fullName', contact.full_name,
        'roleTitle', contact.role_title,
        'email', contact.email,
        'phone', contact.phone,
        'sourceType', contact.source_type,
        'sourceUrl', contact.source_url,
        'verificationStatus', contact.verification_status,
        'outreachEligible', contact.outreach_eligible,
        'observedAt', contact.observed_at
      ) order by contact.observed_at desc, contact.id desc
    ) filter (where contact.suppressed_at is null) as contact_details,
    count(*) filter (where contact.suppressed_at is null) as contact_count
  from public.prospect_contacts contact
  where contact.prospect_id = prospect.id
) contacts on true
left join lateral (
  select
    count(*) as location_count,
    (array_agg(location.google_place_id order by location.is_primary desc, location.observed_at desc, location.id desc)
      filter (where location.google_place_id is not null))[1] as google_place_id
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

revoke all on table public.prospect_current from public, anon, authenticated;
grant select on table public.prospect_current to service_role;
