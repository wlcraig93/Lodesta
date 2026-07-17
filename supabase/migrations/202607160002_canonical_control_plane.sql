-- Canonical business control plane and immutable generation inputs.
--
-- This is an intentional pre-launch hard cutover. An operator must remove or
-- regenerate pre-cutover site/candidate data before applying this migration.

do $$
declare
  table_name text;
  has_rows boolean;
begin
  foreach table_name in array array[
    'site_candidates',
    'site_versions',
    'sites',
    'businesses',
    'business_locations',
    'business_profiles',
    'site_assets',
    'forms',
    'fact_candidates',
    'business_services',
    'owner_audit_log',
    'fact_revisions',
    'publish_records'
  ] loop
    if to_regclass(format('public.%I', table_name)) is null then
      continue;
    end if;
    execute format('select exists (select 1 from public.%I limit 1)', table_name) into has_rows;
    if has_rows then
      raise exception 'canonical control-plane cutover requires % to be empty', table_name;
    end if;
  end loop;
end $$;

drop table if exists publish_records;
drop table if exists fact_revisions;
drop table if exists owner_audit_log;
drop table if exists business_service_attributes;
drop table if exists business_services;
drop table if exists service_definitions;
drop table if exists fact_candidates;
drop table if exists external_sources;
drop table if exists forms;
drop table if exists site_assets;
drop table if exists business_profiles;
drop table if exists site_locations;

alter table businesses
  drop column if exists profile_json,
  add column state_revision integer not null default 1 check (state_revision > 0),
  add column state_hash text not null,
  add column description text,
  add column categories text[] not null default '{}',
  add column social_links text[] not null default '{}',
  add column booking_links text[] not null default '{}',
  add column ordering_links text[] not null default '{}',
  add column press_links text[] not null default '{}';

create table source_snapshots (
  id text primary key,
  business_id text not null references businesses(id) on delete restrict,
  source_type text not null check (source_type in ('website', 'google_places', 'owner_input', 'operator_input')),
  source_url text,
  content_hash text not null,
  captured_at timestamptz not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table fact_observations (
  id text primary key,
  business_id text not null references businesses(id) on delete restrict,
  source_snapshot_id text not null references source_snapshots(id) on delete restrict,
  field text not null,
  value jsonb not null,
  normalized_value jsonb,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  status text not null check (status in ('observed', 'selected_for_preview', 'conflict', 'superseded', 'rejected')),
  source_block_id text,
  observed_at timestamptz not null
);

create table business_offerings (
  id text primary key,
  business_id text not null references businesses(id) on delete restrict,
  catalog_id text,
  custom_name text,
  status text not null check (status in ('observed', 'confirmed', 'rejected', 'inactive')),
  visibility text not null check (visibility in ('preview', 'public', 'hidden')),
  page_mode text not null check (page_mode in ('none', 'shared', 'dedicated')),
  featured boolean not null default false,
  evidence_ids text[] not null default '{}',
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check (catalog_id is not null or custom_name is not null)
);

create table business_proof (
  id text primary key,
  business_id text not null references businesses(id) on delete restrict,
  kind text not null check (kind in ('testimonial', 'credential', 'warranty', 'award', 'offer', 'insurance_support', 'longevity')),
  status text not null check (status in ('observed', 'confirmed', 'rejected', 'inactive')),
  public_text text,
  source_excerpt text,
  source_snapshot_id text references source_snapshots(id) on delete restrict,
  source_block_id text,
  evidence_ids text[] not null default '{}',
  expires_at timestamptz,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table asset_revisions (
  id text primary key,
  asset_id text not null,
  business_id text not null references businesses(id) on delete restrict,
  schema_version text not null check (schema_version = 'asset-revision-v1'),
  content_hash text not null,
  storage_path text not null,
  public_url text,
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  bytes integer not null check (bytes > 0),
  width integer,
  height integer,
  provenance jsonb,
  rights_status text not null check (rights_status in ('preclaim_safe', 'customer_granted', 'reference_only', 'unknown')),
  attestation jsonb,
  created_at timestamptz not null
);

create table business_assets (
  id text primary key,
  business_id text not null references businesses(id) on delete restrict,
  kind text not null check (kind in ('photo', 'logo', 'mockup', 'screenshot', 'icon', 'document', 'other')),
  alt text not null,
  source text not null check (source in ('generated', 'licensed', 'uploaded', 'website_reference', 'placeholder')),
  usage_scope text not null check (usage_scope in ('preclaim_preview', 'published_site', 'owner_dashboard', 'internal_planning', 'reference_only')),
  owner_approved boolean not null default false,
  metadata jsonb not null default '{}',
  active boolean not null default true,
  current_revision_id text not null references asset_revisions(id) on delete restrict,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table site_intents (
  id text primary key,
  site_id text not null unique,
  schema_version text not null check (schema_version = 'site-intent-v1'),
  revision integer not null check (revision > 0),
  intent_hash text not null,
  intent jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table form_definitions (
  id text primary key,
  site_id text not null,
  schema_version text not null check (schema_version = 'form-definition-v1'),
  definition jsonb not null,
  created_at timestamptz not null
);

create table generation_input_snapshots (
  id text primary key,
  business_id text not null references businesses(id) on delete restrict,
  site_id text not null,
  schema_version text not null check (schema_version = 'generation-input-snapshot-v1'),
  business_state_revision integer not null,
  site_intent_revision integer not null,
  form_definition_id text not null references form_definitions(id) on delete restrict,
  input_hash text not null,
  eligibility_mode text not null check (eligibility_mode in ('protected_preview', 'public')),
  snapshot jsonb not null,
  created_at timestamptz not null,
  unique (site_id, input_hash)
);

create table generation_snapshot_sources (
  snapshot_id text not null references generation_input_snapshots(id) on delete restrict,
  source_snapshot_id text not null references source_snapshots(id) on delete restrict,
  primary key (snapshot_id, source_snapshot_id)
);

create table generation_snapshot_asset_revisions (
  snapshot_id text not null references generation_input_snapshots(id) on delete restrict,
  asset_revision_id text not null references asset_revisions(id) on delete restrict,
  primary key (snapshot_id, asset_revision_id)
);

create table control_plane_change_requests (
  id text primary key,
  business_id text not null references businesses(id) on delete restrict,
  site_id text not null,
  schema_version text not null check (schema_version = 'control-plane-change-request-v1'),
  target_authority text not null check (target_authority in ('business_state', 'site_intent')),
  change_kind text not null,
  payload jsonb not null,
  impact text not null check (impact in ('deterministic', 'structural')),
  status text not null check (status in ('pending', 'approved', 'rejected', 'applied', 'failed')),
  requested_by text not null,
  requested_at timestamptz not null,
  decided_by text,
  decided_at timestamptz,
  failure_reason text
);

alter table site_versions
  add column input_snapshot_id text not null references generation_input_snapshots(id) on delete restrict,
  add column form_definition_id text not null references form_definitions(id) on delete restrict;

alter table site_candidates
  drop constraint if exists site_candidates_status_check,
  drop column if exists bundle_json,
  add column input_snapshot_id text not null references generation_input_snapshots(id) on delete restrict,
  add column version_model jsonb not null,
  add column form_definition_id text not null references form_definitions(id) on delete restrict,
  add column generation_plan jsonb not null,
  add column site_copy jsonb not null,
  add column evidence_manifest jsonb not null,
  add column stale_reason text,
  add constraint site_candidates_status_check check (status in ('ready', 'blocked', 'stale', 'accepted', 'archived'));

create index source_snapshots_business_idx on source_snapshots(business_id, captured_at desc);
create index fact_observations_business_idx on fact_observations(business_id, field, status);
create index business_offerings_business_idx on business_offerings(business_id, status);
create index business_proof_business_idx on business_proof(business_id, status);
create index asset_revisions_business_idx on asset_revisions(business_id, asset_id);
create index business_assets_business_idx on business_assets(business_id, active);
create index generation_input_snapshots_site_idx on generation_input_snapshots(site_id, created_at desc);
create index control_plane_change_requests_site_idx on control_plane_change_requests(site_id, requested_at desc);

alter table source_snapshots enable row level security;
alter table fact_observations enable row level security;
alter table business_offerings enable row level security;
alter table business_proof enable row level security;
alter table asset_revisions enable row level security;
alter table business_assets enable row level security;
alter table site_intents enable row level security;
alter table form_definitions enable row level security;
alter table generation_input_snapshots enable row level security;
alter table generation_snapshot_sources enable row level security;
alter table generation_snapshot_asset_revisions enable row level security;
alter table control_plane_change_requests enable row level security;

grant select, insert, update, delete on source_snapshots to service_role;
grant select, insert, update, delete on fact_observations to service_role;
grant select, insert, update, delete on business_offerings to service_role;
grant select, insert, update, delete on business_proof to service_role;
grant select, insert, update, delete on asset_revisions to service_role;
grant select, insert, update, delete on business_assets to service_role;
grant select, insert, update, delete on site_intents to service_role;
grant select, insert, update, delete on form_definitions to service_role;
grant select, insert, update, delete on generation_input_snapshots to service_role;
grant select, insert, update, delete on generation_snapshot_sources to service_role;
grant select, insert, update, delete on generation_snapshot_asset_revisions to service_role;
grant select, insert, update, delete on control_plane_change_requests to service_role;
