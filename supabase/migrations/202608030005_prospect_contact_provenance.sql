-- Split prospect people, contact points, and source observations; replace free-form
-- affiliations with lightweight organization groups. Existing prospect data is
-- fully backfilled before obsolete tables are removed.

alter table public.prospect_observations
  add column source_provider text;

create table public.prospect_people (
  id text primary key,
  prospect_id text not null references public.prospects(id) on delete restrict,
  location_id text,
  contact_type text not null check (contact_type in ('business_general', 'owner', 'manager', 'marketing')),
  full_name text not null,
  role_title text,
  status text not null default 'unknown' check (status in ('current', 'former', 'unknown')),
  source_type text not null check (source_type in ('manual_research', 'licensed_dataset', 'open_dataset', 'business_website', 'public_listing', 'public_registry', 'owner_verified', 'import')),
  source_provider text,
  source_url text,
  source_id text references public.prospect_sources(id) on delete restrict,
  source_run_id text,
  source_record_key text,
  verification_status text not null check (verification_status in ('public_source', 'owner_verified', 'unverified')),
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, prospect_id) references public.prospect_locations(id, prospect_id) on delete restrict,
  foreign key (source_run_id, source_id) references public.prospect_source_runs(id, source_id) on delete restrict,
  check (verification_status <> 'public_source' or source_url is not null)
);

create table public.prospect_contact_points (
  id text primary key,
  prospect_id text not null references public.prospects(id) on delete restrict,
  person_id text references public.prospect_people(id) on delete restrict,
  location_id text,
  kind text not null check (kind in ('phone', 'email')),
  normalized_value text not null,
  display_value text not null,
  phone_type text check (phone_type in ('main', 'direct', 'mobile', 'toll_free', 'fax', 'unknown')),
  extension text,
  status text not null default 'active' check (status in ('active', 'stale', 'invalid')),
  is_preferred boolean not null default false,
  outreach_eligible boolean not null default false,
  suppressed_at timestamptz,
  suppression_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, prospect_id) references public.prospect_locations(id, prospect_id) on delete restrict,
  check ((kind = 'phone' and phone_type is not null) or (kind = 'email' and phone_type is null and extension is null)),
  check (suppressed_at is null or suppression_reason is not null)
);

create table public.prospect_contact_point_observations (
  id text primary key,
  contact_point_id text not null references public.prospect_contact_points(id) on delete restrict,
  source_type text not null check (source_type in ('manual_research', 'licensed_dataset', 'open_dataset', 'business_website', 'public_listing', 'public_registry', 'owner_verified', 'import')),
  source_provider text,
  source_url text,
  source_id text references public.prospect_sources(id) on delete restrict,
  source_run_id text,
  source_record_key text,
  verification_status text not null check (verification_status in ('public_source', 'owner_verified', 'unverified')),
  observed_at timestamptz not null,
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (source_run_id, source_id) references public.prospect_source_runs(id, source_id) on delete restrict,
  check (verification_status <> 'public_source' or source_url is not null)
);

create table public.prospect_organization_groups (
  id text primary key,
  canonical_key text not null unique,
  name text not null,
  group_type text not null check (group_type in ('national_chain', 'franchise_system', 'regional_group', 'acquisition_platform', 'other')),
  canonical_domain text,
  default_eligibility_status text check (default_eligibility_status in ('review_required', 'disqualified')),
  default_disqualification_reason text check (default_disqualification_reason in ('national_corporate_chain', 'franchise', 'institutional_or_government', 'supplier_or_retailer', 'outside_target_industry', 'outside_target_market', 'permanently_closed', 'duplicate_record', 'invalid_business_identity', 'manual_exclusion')),
  source_type text not null check (source_type in ('manual_research', 'licensed_dataset', 'open_dataset', 'business_website', 'public_listing', 'public_registry', 'owner_verified', 'import')),
  source_provider text,
  source_url text,
  observed_at timestamptz not null,
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (default_eligibility_status <> 'disqualified' or default_disqualification_reason is not null)
);

create table public.prospect_organization_memberships (
  id text primary key,
  prospect_id text not null references public.prospects(id) on delete restrict,
  group_id text not null references public.prospect_organization_groups(id) on delete restrict,
  relationship text not null check (relationship in ('company_owned_location', 'franchisee', 'subsidiary', 'operates_brand', 'same_enterprise', 'unknown')),
  confidence text not null check (confidence in ('confirmed', 'likely', 'possible')),
  source_type text not null check (source_type in ('manual_research', 'licensed_dataset', 'open_dataset', 'business_website', 'public_listing', 'public_registry', 'owner_verified', 'import')),
  source_provider text,
  source_url text,
  observed_at timestamptz not null,
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (prospect_id, group_id, relationship)
);

create index prospect_people_prospect_type_idx on public.prospect_people(prospect_id, contact_type, status);
create unique index prospect_people_identity_idx on public.prospect_people(prospect_id, lower(full_name), contact_type);
create index prospect_contact_points_prospect_kind_idx on public.prospect_contact_points(prospect_id, kind, status);
create index prospect_contact_points_person_idx on public.prospect_contact_points(person_id) where person_id is not null;
create index prospect_contact_points_location_idx on public.prospect_contact_points(location_id) where location_id is not null;
create unique index prospect_contact_points_identity_idx on public.prospect_contact_points(prospect_id, coalesce(person_id, ''), coalesce(location_id, ''), kind, normalized_value);
create unique index prospect_contact_points_one_preferred_idx on public.prospect_contact_points(prospect_id, kind) where is_preferred and status = 'active' and suppressed_at is null;
create index prospect_contact_observations_point_latest_idx on public.prospect_contact_point_observations(contact_point_id, observed_at desc, id desc);
create index prospect_contact_observations_source_idx on public.prospect_contact_point_observations(source_provider, observed_at desc) where source_provider is not null;
create index prospect_organization_groups_domain_idx on public.prospect_organization_groups(canonical_domain) where canonical_domain is not null;
create index prospect_organization_memberships_prospect_idx on public.prospect_organization_memberships(prospect_id, relationship, confidence);
create index prospect_organization_memberships_group_idx on public.prospect_organization_memberships(group_id, relationship);

insert into public.prospect_people (
  id, prospect_id, contact_type, full_name, role_title, status, source_type, source_provider,
  source_url, verification_status, observed_at, created_at, updated_at
)
select distinct on (contact.prospect_id, lower(contact.full_name), contact.contact_type)
  'prospect_person_' || substr(encode(extensions.digest(contact.prospect_id || ':' || contact.contact_type || ':' || lower(trim(contact.full_name)), 'sha256'), 'hex'), 1, 32),
  contact.prospect_id,
  contact.contact_type,
  trim(contact.full_name),
  contact.role_title,
  'unknown',
  contact.source_type,
  case
    when contact.source_type = 'public_listing' and contact.source_url ilike '%google.%' then 'google_business_profile'
    when contact.source_type = 'business_website' then 'business_website'
    when contact.source_type = 'public_registry' then 'public_registry'
    else contact.source_type
  end,
  contact.source_url,
  contact.verification_status,
  contact.observed_at,
  contact.created_at,
  contact.updated_at
from public.prospect_contacts contact
where contact.full_name is not null
order by contact.prospect_id, lower(contact.full_name), contact.contact_type, contact.observed_at desc, contact.id desc;

with values_to_migrate as (
  select contact.*, 'email'::text as kind, lower(trim(contact.email)) as normalized_value, trim(contact.email) as display_value
  from public.prospect_contacts contact where contact.email is not null
  union all
  select contact.*, 'phone'::text as kind, trim(contact.phone) as normalized_value, trim(contact.phone) as display_value
  from public.prospect_contacts contact where contact.phone is not null
), resolved as (
  select value.*,
    case when value.full_name is null then null else
      'prospect_person_' || substr(encode(extensions.digest(value.prospect_id || ':' || value.contact_type || ':' || lower(trim(value.full_name)), 'sha256'), 'hex'), 1, 32)
    end as person_id,
    'prospect_contact_point_' || substr(encode(extensions.digest(
      value.prospect_id || ':' ||
      coalesce(case when value.full_name is null then null else 'prospect_person_' || substr(encode(extensions.digest(value.prospect_id || ':' || value.contact_type || ':' || lower(trim(value.full_name)), 'sha256'), 'hex'), 1, 32) end, '') || '::' ||
      value.kind || ':' || value.normalized_value
    , 'sha256'), 'hex'), 1, 32) as point_id
  from values_to_migrate value
)
insert into public.prospect_contact_points (
  id, prospect_id, person_id, kind, normalized_value, display_value, phone_type, status,
  is_preferred, outreach_eligible, suppressed_at, suppression_reason, created_at, updated_at
)
select
  resolved.point_id,
  resolved.prospect_id,
  resolved.person_id,
  resolved.kind,
  resolved.normalized_value,
  resolved.display_value,
  case when resolved.kind = 'phone' then 'unknown' end,
  'active',
  false,
  bool_or(resolved.outreach_eligible),
  max(resolved.suppressed_at),
  (array_agg(resolved.suppression_reason order by resolved.observed_at desc) filter (where resolved.suppression_reason is not null))[1],
  min(resolved.created_at),
  max(resolved.updated_at)
from resolved
group by resolved.point_id, resolved.prospect_id, resolved.person_id, resolved.kind, resolved.normalized_value, resolved.display_value;

with values_to_migrate as (
  select contact.*, 'email'::text as kind, lower(trim(contact.email)) as normalized_value
  from public.prospect_contacts contact where contact.email is not null
  union all
  select contact.*, 'phone'::text as kind, trim(contact.phone) as normalized_value
  from public.prospect_contacts contact where contact.phone is not null
), resolved as (
  select value.*,
    'prospect_contact_point_' || substr(encode(extensions.digest(
      value.prospect_id || ':' ||
      coalesce(case when value.full_name is null then null else 'prospect_person_' || substr(encode(extensions.digest(value.prospect_id || ':' || value.contact_type || ':' || lower(trim(value.full_name)), 'sha256'), 'hex'), 1, 32) end, '') || '::' ||
      value.kind || ':' || value.normalized_value
    , 'sha256'), 'hex'), 1, 32) as point_id
  from values_to_migrate value
)
insert into public.prospect_contact_point_observations (
  id, contact_point_id, source_type, source_provider, source_url, verification_status,
  observed_at, evidence, created_at
)
select
  'prospect_contact_observation_' || md5(resolved.point_id || ':' || resolved.source_type || ':' || coalesce(resolved.source_url, '') || ':' || resolved.observed_at::text),
  resolved.point_id,
  resolved.source_type,
  case
    when resolved.source_type = 'public_listing' and resolved.source_url ilike '%google.%' then 'google_business_profile'
    when resolved.source_type = 'business_website' then 'business_website'
    when resolved.source_type = 'public_registry' then 'public_registry'
    else resolved.source_type
  end,
  resolved.source_url,
  resolved.verification_status,
  resolved.observed_at,
  '{}'::jsonb,
  resolved.created_at
from resolved
on conflict (id) do nothing;

insert into public.prospect_organization_groups (
  id, canonical_key, name, group_type, default_eligibility_status, default_disqualification_reason,
  source_type, source_provider, source_url, observed_at, evidence, created_at, updated_at
)
select distinct on (lower(trim(affiliation.related_organization_name)))
  'prospect_org_group_' || substr(encode(extensions.digest('organization:' || lower(trim(affiliation.related_organization_name)), 'sha256'), 'hex'), 1, 32),
  'organization:' || lower(trim(affiliation.related_organization_name)),
  trim(affiliation.related_organization_name),
  case when affiliation.affiliation_type = 'franchisee_of' then 'franchise_system' else 'other' end,
  case when affiliation.affiliation_type = 'franchisee_of' then 'disqualified' end,
  case when affiliation.affiliation_type = 'franchisee_of' then 'franchise' end,
  'manual_research',
  'legacy_affiliation',
  affiliation.source_url,
  affiliation.observed_at,
  affiliation.evidence,
  affiliation.created_at,
  affiliation.updated_at
from public.prospect_affiliations affiliation
order by lower(trim(affiliation.related_organization_name)), affiliation.observed_at desc, affiliation.id desc;

insert into public.prospect_organization_memberships (
  id, prospect_id, group_id, relationship, confidence, source_type, source_provider,
  source_url, observed_at, evidence, created_at, updated_at
)
select
  'prospect_org_membership_' || substr(encode(extensions.digest(
    affiliation.prospect_id || ':' ||
    'prospect_org_group_' || substr(encode(extensions.digest('organization:' || lower(trim(affiliation.related_organization_name)), 'sha256'), 'hex'), 1, 32) || ':' ||
    case affiliation.affiliation_type
      when 'franchisee_of' then 'franchisee'
      when 'subsidiary_of' then 'subsidiary'
      when 'operates_brand' then 'operates_brand'
      else 'same_enterprise'
    end,
    'sha256'), 'hex'), 1, 32),
  affiliation.prospect_id,
  'prospect_org_group_' || substr(encode(extensions.digest('organization:' || lower(trim(affiliation.related_organization_name)), 'sha256'), 'hex'), 1, 32),
  case affiliation.affiliation_type
    when 'franchisee_of' then 'franchisee'
    when 'subsidiary_of' then 'subsidiary'
    when 'operates_brand' then 'operates_brand'
    else 'same_enterprise'
  end,
  affiliation.confidence,
  'manual_research',
  'legacy_affiliation',
  affiliation.source_url,
  affiliation.observed_at,
  affiliation.evidence,
  affiliation.created_at,
  affiliation.updated_at
from public.prospect_affiliations affiliation;

do $$
begin
  if exists (
    select 1 from public.prospect_contacts legacy
    where legacy.full_name is not null
      and not exists (
        select 1 from public.prospect_people person
        where person.prospect_id = legacy.prospect_id
          and lower(person.full_name) = lower(trim(legacy.full_name))
          and person.contact_type = legacy.contact_type
      )
  ) then raise exception 'contact provenance cutover failed to retain a named person'; end if;
  if exists (
    select 1 from public.prospect_contacts legacy
    where (legacy.email is not null or legacy.phone is not null)
      and not exists (
        select 1
        from public.prospect_contact_points point
        join public.prospect_contact_point_observations observation on observation.contact_point_id = point.id
        where point.prospect_id = legacy.prospect_id
          and ((legacy.email is not null and point.kind = 'email' and point.normalized_value = lower(trim(legacy.email)))
            or (legacy.phone is not null and point.kind = 'phone' and point.normalized_value = trim(legacy.phone)))
          and observation.source_type = legacy.source_type
          and observation.observed_at = legacy.observed_at
      )
  ) then raise exception 'contact provenance cutover failed to retain a sourced contact point'; end if;
  if (select count(*) from public.prospect_organization_memberships) < (select count(*) from public.prospect_affiliations) then
    raise exception 'organization-group cutover failed to retain every affiliation';
  end if;
end
$$;

drop view public.prospect_current;
drop table public.prospect_contacts;
drop table public.prospect_affiliations;

create trigger prospect_people_updated_at before update on public.prospect_people for each row execute function public.set_updated_at();
create trigger prospect_contact_points_updated_at before update on public.prospect_contact_points for each row execute function public.set_updated_at();
create trigger prospect_organization_groups_updated_at before update on public.prospect_organization_groups for each row execute function public.set_updated_at();
create trigger prospect_organization_memberships_updated_at before update on public.prospect_organization_memberships for each row execute function public.set_updated_at();

create view public.prospect_contact_details
with (security_invoker = true)
as
select
  observation.id,
  point.id as contact_point_id,
  person.id as person_id,
  point.location_id,
  point.prospect_id,
  coalesce(person.contact_type, 'business_general') as contact_type,
  person.full_name,
  person.role_title,
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
join public.prospect_contact_point_observations observation on observation.contact_point_id = point.id
join lateral (
  select min(source.observed_at) as first_observed_at, max(source.observed_at) as last_observed_at
  from public.prospect_contact_point_observations source
  where source.contact_point_id = point.id
) bounds on true
union all
select
  person.id,
  null::text,
  person.id,
  person.location_id,
  person.prospect_id,
  person.contact_type,
  person.full_name,
  person.role_title,
  null::text,
  null::text,
  null::text,
  null::text,
  'active'::text,
  false,
  person.source_type,
  person.source_provider,
  person.source_url,
  person.source_id,
  person.source_run_id,
  person.source_record_key,
  person.verification_status,
  false,
  person.observed_at,
  person.observed_at,
  person.observed_at,
  '{}'::jsonb,
  null::timestamptz,
  null::text,
  person.created_at,
  person.updated_at
from public.prospect_people person
where not exists (select 1 from public.prospect_contact_points point where point.person_id = person.id);

create view public.prospect_current
with (security_invoker = true)
as
select
  prospect.id, prospect.canonical_key, prospect.business_name, prospect.legal_business_name, prospect.dba_name,
  prospect.vertical, prospect.industry_code, prospect.market, prospect.ownership_scope, prospect.eligibility_status,
  prospect.disqualification_reason, prospect.eligibility_reason, prospect.eligibility_policy_version,
  prospect.eligibility_source, prospect.eligibility_assessed_at, prospect.status, prospect.website_kind,
  prospect.website_url, prospect.website_host, prospect.address_line_1, prospect.address_line_2, prospect.locality,
  prospect.region, prospect.postal_code, prospect.country_code, prospect.phone, prospect.do_not_contact,
  prospect.suppression_reason, prospect.metadata, prospect.created_at, prospect.updated_at,
  observation.id as latest_observation_id, observation.observed_at as latest_observed_at,
  observation.review_rating as google_rating, observation.review_count as google_review_count,
  locations.google_place_id, observation.years_in_business,
  coalesce(observation.site_builder, observation.cms) as website_platform,
  coalesce(observation.agency_name, observation.managed_provider) as website_provider,
  observation.operating_status, organization.name as brand_name, membership.confidence as brand_confidence,
  contacts.owner_name, contacts.public_email,
  coalesce(contacts.public_phone, case when not prospect.do_not_contact then prospect.phone end) as public_phone,
  coalesce(contacts.contact_details, '[]'::jsonb) as contact_details,
  coalesce(contacts.contact_count, 0)::integer as contact_count,
  coalesce(locations.location_count, 0)::integer as location_count,
  coalesce(licenses.active_license_count, 0)::integer as active_license_count
from public.prospects prospect
left join lateral (
  select current_observation.* from public.prospect_observations current_observation
  where current_observation.prospect_id = prospect.id
  order by current_observation.observed_at desc, current_observation.id desc limit 1
) observation on true
left join lateral (
  select current_membership.* from public.prospect_organization_memberships current_membership
  where current_membership.prospect_id = prospect.id
    and current_membership.relationship in ('company_owned_location', 'franchisee', 'subsidiary', 'operates_brand')
  order by current_membership.observed_at desc, current_membership.id desc limit 1
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

create or replace function public.prune_prospect_source_snapshot(p_source_id text, p_retained_canonical_keys text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  removable_ids text[];
  deleted_prospects integer := 0; deleted_locations integer := 0; deleted_licenses integer := 0;
  deleted_memberships integer := 0; deleted_observations integer := 0; deleted_contact_points integer := 0;
begin
  if p_source_id is null or btrim(p_source_id) = '' then raise exception 'prospect source ID is required'; end if;
  select coalesce(array_agg(prospect.id), '{}'::text[]) into removable_ids from public.prospects prospect
  where prospect.metadata ->> 'acquisitionSource' = p_source_id
    and not (prospect.canonical_key = any(coalesce(p_retained_canonical_keys, '{}'::text[])));
  if cardinality(removable_ids) = 0 then
    return jsonb_build_object('prospects',0,'locations',0,'licenses',0,'organizationMemberships',0,'observations',0,'contacts',0);
  end if;
  if exists (select 1 from public.outbound_prospects membership where membership.prospect_id = any(removable_ids)) then
    raise exception 'prospect source snapshot includes a prospect selected into outbound work';
  end if;
  if exists (select 1 from public.prospect_observations observation where observation.prospect_id = any(removable_ids)
    and (observation.website_assessment_id is not null or observation.prospect_report_id is not null)) then
    raise exception 'prospect source snapshot includes an observation linked to a report or assessment';
  end if;
  delete from public.prospect_organization_memberships membership where membership.prospect_id = any(removable_ids);
  get diagnostics deleted_memberships = row_count;
  delete from public.prospect_contact_point_observations source using public.prospect_contact_points point
    where source.contact_point_id = point.id and point.prospect_id = any(removable_ids);
  delete from public.prospect_contact_points point where point.prospect_id = any(removable_ids);
  get diagnostics deleted_contact_points = row_count;
  delete from public.prospect_people person where person.prospect_id = any(removable_ids);
  delete from public.prospect_observations observation where observation.prospect_id = any(removable_ids);
  get diagnostics deleted_observations = row_count;
  delete from public.prospect_licenses license where license.prospect_id = any(removable_ids);
  get diagnostics deleted_licenses = row_count;
  delete from public.prospect_locations location where location.prospect_id = any(removable_ids);
  get diagnostics deleted_locations = row_count;
  delete from public.prospects prospect where prospect.id = any(removable_ids);
  get diagnostics deleted_prospects = row_count;
  return jsonb_build_object('prospects',deleted_prospects,'locations',deleted_locations,'licenses',deleted_licenses,
    'organizationMemberships',deleted_memberships,'observations',deleted_observations,'contacts',deleted_contact_points);
end
$$;

alter table public.prospect_people enable row level security;
alter table public.prospect_contact_points enable row level security;
alter table public.prospect_contact_point_observations enable row level security;
alter table public.prospect_organization_groups enable row level security;
alter table public.prospect_organization_memberships enable row level security;

revoke all on table public.prospect_people, public.prospect_contact_points, public.prospect_contact_point_observations,
  public.prospect_organization_groups, public.prospect_organization_memberships,
  public.prospect_contact_details, public.prospect_current from public, anon, authenticated;
grant select, insert, update on table public.prospect_people, public.prospect_contact_points,
  public.prospect_organization_groups, public.prospect_organization_memberships to service_role;
grant select, insert on table public.prospect_contact_point_observations to service_role;
grant select on table public.prospect_contact_details, public.prospect_current to service_role;
