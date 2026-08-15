-- Keep only normalized business, location, contact, website, and Google data.
-- License/source infrastructure was useful for scraping, but is not part of the
-- cross-industry prospect product model.

drop view public.prospect_current;
drop function public.prune_prospect_source_snapshot(text, text[]);

with license_people as (
  select
    license.prospect_id,
    lower(btrim(license.responsible_person_name)) as normalized_name,
    min(btrim(license.responsible_person_name)) as full_name,
    lower(coalesce(nullif(btrim(license.responsible_person_title), ''), 'responsible person')) as normalized_title,
    min(coalesce(nullif(btrim(license.responsible_person_title), ''), 'Responsible person')) as role_title,
    max(license.observed_at) as observed_at,
    min(license.created_at) as created_at,
    max(license.updated_at) as updated_at
  from public.prospect_licenses license
  where nullif(btrim(license.responsible_person_name), '') is not null
  group by
    license.prospect_id,
    lower(btrim(license.responsible_person_name)),
    lower(coalesce(nullif(btrim(license.responsible_person_title), ''), 'responsible person'))
)
insert into public.prospect_contacts (
  id,
  prospect_id,
  location_id,
  full_name,
  role_title,
  observed_at,
  created_at,
  updated_at
)
select
  'prospect_contact_' || md5(concat_ws('|',
    person.prospect_id,
    person.normalized_name,
    person.normalized_title
  )),
  person.prospect_id,
  null,
  person.full_name,
  person.role_title,
  person.observed_at,
  person.created_at,
  person.updated_at
from license_people person
where not exists (
  select 1
  from public.prospect_contacts contact
  where contact.prospect_id = person.prospect_id
    and lower(btrim(contact.full_name)) = person.normalized_name
)
on conflict (id) do nothing;

alter table public.prospect_locations
  drop column source_id,
  drop column source_run_id,
  drop column source_record_key,
  drop column observed_at;

alter table public.prospect_contacts
  drop column source_url,
  drop column source_id,
  drop column source_run_id,
  drop column source_record_key,
  drop column observed_at;

drop table public.prospect_licenses;
drop table public.prospect_source_records;
drop table public.prospect_source_runs;
drop table public.prospect_sources;

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
    location.updated_at desc,
    location.id
  limit 1
) primary_location on true
left join lateral (
  select
    (array_agg(contact.full_name order by contact.updated_at desc)
      filter (where lower(coalesce(contact.role_title, '')) similar to '%(owner|founder|principal)%'))[1] as owner_name,
    (array_agg(contact.full_name order by contact.updated_at desc)
      filter (where contact.full_name is not null))[1] as primary_contact_name,
    (array_agg(contact.email order by contact.updated_at desc)
      filter (where contact.email is not null))[1] as public_email,
    (array_agg(contact.phone order by contact.updated_at desc)
      filter (where contact.phone is not null))[1] as public_phone,
    jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', contact.id,
      'locationId', contact.location_id,
      'fullName', contact.full_name,
      'roleTitle', contact.role_title,
      'email', contact.email,
      'phone', contact.phone
    )) order by contact.updated_at desc, contact.id) as contact_details
  from public.prospect_contacts contact
  where contact.prospect_id = prospect.id
) contacts on true;

revoke all on table public.prospect_current from public, anon, authenticated;
grant select on table public.prospect_current to service_role;
