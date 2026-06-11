-- Evidence/truth model v1 (production-readiness plan, Phase 1).
--
-- Evidence is flexible (fact_candidates); confirmed truth stays in typed
-- domain tables (businesses, business_locations, business_services).
-- google_places candidates persist NO durable raw values: place_id,
-- field_key, observed_at, and comparison metadata only — values are
-- live-resolved in preview/confirmation sessions and persisted only as
-- owner-confirmed truth.

create table if not exists external_sources (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  source_type text not null check (source_type in ('website', 'web_search', 'google_places', 'owner_input')),
  external_ref text,
  connected_by_owner boolean not null default false,
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists external_sources_business_idx on external_sources(business_id);

create table if not exists fact_candidates (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  source_id text references external_sources(id) on delete set null,
  source_type text not null check (source_type in ('website', 'web_search', 'google_places', 'owner_input')),
  field_key text not null,
  -- Null for google_places rows: values are live-resolved, never persisted.
  proposed_value jsonb,
  normalized_value jsonb,
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  status text not null default 'discovered'
    check (status in ('discovered', 'system_selected_for_preview', 'owner_confirmed', 'owner_rejected', 'superseded', 'drift_candidate')),
  evidence_label text,
  evidence_excerpt text,
  evidence_url text,
  -- google_places comparison metadata (no raw values)
  place_id text,
  comparison_result jsonb,
  observed_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists fact_candidates_business_idx on fact_candidates(business_id, field_key, status);

create table if not exists service_definitions (
  id text primary key,
  vertical text not null,
  slug text not null,
  name text not null,
  category text,
  aliases text[] not null default '{}',
  default_questions jsonb not null default '[]',
  page_strategy text not null default 'auto' check (page_strategy in ('auto', 'always', 'never')),
  created_at timestamptz not null default now(),
  unique (vertical, slug)
);

create table if not exists business_services (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  service_definition_id text references service_definitions(id) on delete set null,
  custom_name text,
  status text not null default 'proposed' check (status in ('proposed', 'active', 'hidden', 'rejected')),
  confirmation_source text check (confirmation_source in ('owner', 'website', 'web_search', 'import')),
  owner_notes text,
  pricing_model text,
  starting_price text,
  featured boolean not null default false,
  publish_landing_page boolean,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (service_definition_id is not null or custom_name is not null)
);

create index if not exists business_services_business_idx on business_services(business_id, status);

create table if not exists business_service_attributes (
  id text primary key,
  business_service_id text not null references business_services(id) on delete cascade,
  key text not null,
  value jsonb not null,
  source text not null default 'owner_confirmed' check (source in ('owner_confirmed', 'imported_candidate')),
  created_at timestamptz not null default now(),
  unique (business_service_id, key)
);

alter table external_sources enable row level security;
alter table fact_candidates enable row level security;
alter table service_definitions enable row level security;
alter table business_services enable row level security;
alter table business_service_attributes enable row level security;
