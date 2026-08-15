-- Preserve the Google data already returned during Place matching without
-- treating unresolved candidates as confirmed business locations.

alter table public.prospect_locations
  add column google_primary_type text,
  add column google_business_status text;

create table public.prospect_place_candidates (
  prospect_id text not null references public.prospects(id) on delete cascade,
  google_place_id text not null,
  google_business_name text,
  google_primary_type text,
  google_category text,
  google_address text,
  google_phone text,
  google_website_url text,
  google_maps_url text,
  google_rating numeric(3,2) check (google_rating is null or (google_rating >= 0 and google_rating <= 5)),
  google_review_count integer check (google_review_count is null or google_review_count >= 0),
  google_business_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (prospect_id, google_place_id)
);

create index prospect_place_candidates_place_idx
  on public.prospect_place_candidates(google_place_id);

create trigger prospect_place_candidates_updated_at
  before update on public.prospect_place_candidates
  for each row execute function public.set_updated_at();

alter table public.prospect_place_candidates enable row level security;
revoke all on table public.prospect_place_candidates from public, anon, authenticated;
grant select, insert, update on table public.prospect_place_candidates to service_role;

create or replace view public.prospect_current
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
  prospect.updated_at,
  primary_location.google_primary_type,
  primary_location.google_business_status
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
