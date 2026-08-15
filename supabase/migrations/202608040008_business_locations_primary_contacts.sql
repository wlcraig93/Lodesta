-- Model prospects as website-buying businesses with multiple locations and named contacts.
-- Preserve deterministic business contact data, remove source-shaped location/contact fields,
-- and expose one flat GTM projection for the common single-business workflow.

drop view public.prospect_current;

alter table public.prospects
  add column business_email text;

alter table public.prospect_contacts
  add column is_primary boolean not null default false;

-- An unnamed email is a business contact method. Backfill it only when the
-- prospect has exactly one distinct candidate; ambiguous candidates remain in
-- the pre-cutover audit workbook for operator review.
with unambiguous_business_emails as (
  select
    prospect_id,
    min(lower(btrim(email))) as business_email
  from public.prospect_contacts
  where nullif(btrim(full_name), '') is null
    and nullif(btrim(email), '') is not null
  group by prospect_id
  having count(distinct lower(btrim(email))) = 1
)
update public.prospects prospect
set business_email = candidate.business_email,
    updated_at = now()
from unambiguous_business_emails candidate
where prospect.id = candidate.prospect_id;

-- Consolidate repeated observations of the same named person. Favor the role
-- most useful for GTM and merge complementary email/phone facts.
create temporary table prospect_named_contact_rollup on commit drop as
with ranked as (
  select
    contact.*,
    lower(btrim(contact.full_name)) as normalized_name,
    case
      when lower(coalesce(contact.role_title, '')) ~ '(owner|founder|principal)' then 100
      when lower(coalesce(contact.role_title, '')) ~ '(president|chief executive|ceo|managing member|partner)' then 90
      when lower(coalesce(contact.role_title, '')) ~ 'manager' then 70
      when lower(coalesce(contact.role_title, '')) ~ 'operator' then 50
      when lower(coalesce(contact.role_title, '')) ~ 'applicator' then 40
      else 10
    end as role_rank
  from public.prospect_contacts contact
  where nullif(btrim(contact.full_name), '') is not null
)
select
  prospect_id,
  normalized_name,
  (array_agg(id order by role_rank desc, (email is not null) desc, (phone is not null) desc, updated_at desc, id))[1] as keeper_id,
  (array_agg(btrim(full_name) order by role_rank desc, updated_at desc, id))[1] as full_name,
  (array_agg(nullif(btrim(role_title), '') order by role_rank desc, updated_at desc, id)
    filter (where nullif(btrim(role_title), '') is not null))[1] as role_title,
  (array_agg(lower(btrim(email)) order by role_rank desc, updated_at desc, id)
    filter (where nullif(btrim(email), '') is not null))[1] as email,
  (array_agg(btrim(phone) order by role_rank desc, updated_at desc, id)
    filter (where nullif(btrim(phone), '') is not null))[1] as phone,
  min(created_at) as created_at,
  max(updated_at) as updated_at
from ranked
group by prospect_id, normalized_name;

update public.prospect_contacts contact
set
  full_name = rollup.full_name,
  role_title = rollup.role_title,
  email = rollup.email,
  phone = rollup.phone,
  created_at = rollup.created_at,
  updated_at = rollup.updated_at
from prospect_named_contact_rollup rollup
where contact.id = rollup.keeper_id;

delete from public.prospect_contacts contact
using prospect_named_contact_rollup rollup
where contact.prospect_id = rollup.prospect_id
  and lower(btrim(contact.full_name)) = rollup.normalized_name
  and contact.id <> rollup.keeper_id;

-- Unnamed phone/email rows have been either normalized onto the business or
-- retained in the audit workbook. Contacts now represent people only.
delete from public.prospect_contacts
where nullif(btrim(full_name), '') is null;

-- Pick one default person per business, preferring actual business authority.
with ranked as (
  select
    contact.id,
    row_number() over (
      partition by contact.prospect_id
      order by
        case
          when lower(coalesce(contact.role_title, '')) ~ '(owner|founder|principal)' then 100
          when lower(coalesce(contact.role_title, '')) ~ '(president|chief executive|ceo|managing member|partner)' then 90
          when lower(coalesce(contact.role_title, '')) ~ 'manager' then 70
          when lower(coalesce(contact.role_title, '')) ~ 'operator' then 50
          when lower(coalesce(contact.role_title, '')) ~ 'applicator' then 40
          else 10
        end desc,
        (contact.email is not null) desc,
        (contact.phone is not null) desc,
        contact.updated_at desc,
        contact.id
    ) as contact_rank
  from public.prospect_contacts contact
)
update public.prospect_contacts contact
set is_primary = ranked.contact_rank = 1
from ranked
where contact.id = ranked.id;

alter table public.prospect_contacts
  drop constraint if exists prospect_contacts_location_id_prospect_id_fkey,
  drop constraint if exists prospect_contacts_check,
  drop column location_id,
  alter column full_name set not null,
  add constraint prospect_contacts_full_name_not_blank
    check (nullif(btrim(full_name), '') is not null);

drop index if exists public.prospect_locations_prospect_status_idx;
drop index if exists public.prospect_locations_region_locality_idx;
drop index if exists public.prospect_locations_place_idx;

alter table public.prospect_locations
  drop column status,
  drop constraint if exists prospect_locations_id_prospect_id_key;

create index prospect_locations_prospect_primary_idx
  on public.prospect_locations(prospect_id, is_primary desc, updated_at desc);
create index prospect_locations_region_locality_idx
  on public.prospect_locations(region, locality, prospect_id);
create index prospect_contacts_prospect_idx
  on public.prospect_contacts(prospect_id, is_primary desc, updated_at desc);
create unique index prospect_contacts_one_primary_idx
  on public.prospect_contacts(prospect_id)
  where is_primary;

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
  prospect.business_email,
  primary_location.address_line_1,
  primary_location.address_line_2,
  primary_location.locality,
  primary_location.region,
  primary_location.postal_code,
  primary_location.country_code,
  primary_location.county,
  primary_location.phone as location_phone,
  primary_location.google_business_name,
  primary_location.google_category,
  primary_location.google_address,
  primary_location.google_phone,
  primary_location.google_website_url,
  primary_location.google_maps_url,
  primary_location.google_place_id,
  primary_location.google_rating,
  primary_location.google_review_count,
  primary_contact.full_name as primary_contact_name,
  primary_contact.role_title as primary_contact_role,
  primary_contact.email as primary_contact_email,
  primary_contact.phone as primary_contact_phone,
  coalesce(primary_contact.email, prospect.business_email) as outreach_email,
  coalesce(primary_contact.phone, primary_location.phone, primary_location.google_phone) as outreach_phone,
  coalesce(contact_list.contact_details, '[]'::jsonb) as contact_details,
  prospect.created_at,
  prospect.updated_at
from public.prospects prospect
left join lateral (
  select location.*
  from public.prospect_locations location
  where location.prospect_id = prospect.id
  order by
    location.is_primary desc,
    (location.google_place_id is not null) desc,
    location.updated_at desc,
    location.id
  limit 1
) primary_location on true
left join lateral (
  select contact.*
  from public.prospect_contacts contact
  where contact.prospect_id = prospect.id
  order by
    contact.is_primary desc,
    case
      when lower(coalesce(contact.role_title, '')) ~ '(owner|founder|principal)' then 100
      when lower(coalesce(contact.role_title, '')) ~ '(president|chief executive|ceo|managing member|partner)' then 90
      when lower(coalesce(contact.role_title, '')) ~ 'manager' then 70
      when lower(coalesce(contact.role_title, '')) ~ 'operator' then 50
      when lower(coalesce(contact.role_title, '')) ~ 'applicator' then 40
      else 10
    end desc,
    contact.updated_at desc,
    contact.id
  limit 1
) primary_contact on true
left join lateral (
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', contact.id,
    'fullName', contact.full_name,
    'roleTitle', contact.role_title,
    'email', contact.email,
    'phone', contact.phone,
    'isPrimary', contact.is_primary
  )) order by contact.is_primary desc, contact.updated_at desc, contact.id) as contact_details
  from public.prospect_contacts contact
  where contact.prospect_id = prospect.id
) contact_list on true;

revoke all on table public.prospect_current from public, anon, authenticated;
grant select on table public.prospect_current to service_role;
