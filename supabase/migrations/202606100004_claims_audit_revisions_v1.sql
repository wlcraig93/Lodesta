-- Phase 1.5: claim verification levels, owner audit log, fact revisions.
--
-- Verification levels are honest about what they prove:
--   unverified        — no checkout, publish, or owner power
--   contact_verified  — code to the business's publicly listed number (access)
--   owner_verified    — domain email / DNS proof / documentation (ownership)
--   operator_verified — manual operator review (disputes, legal-sensitive)
-- Higher-risk actions check the level; phone access alone cannot repoint a
-- domain or delete data.

alter table claims add column if not exists verification_level text not null default 'unverified'
  check (verification_level in ('unverified', 'contact_verified', 'owner_verified', 'operator_verified'));
alter table claims add column if not exists verification_method text;
alter table claims add column if not exists verified_by text;
alter table claims add column if not exists verified_at timestamptz;

create table if not exists owner_audit_log (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  site_id text,
  actor text not null,
  actor_role text not null check (actor_role in ('owner', 'operator', 'system')),
  action text not null,
  field_key text,
  prior_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create index if not exists owner_audit_log_business_idx on owner_audit_log(business_id, created_at desc);

create table if not exists fact_revisions (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  field_key text not null,
  value jsonb not null,
  revision int not null,
  source text not null check (source in ('owner_confirmed', 'system_selected_for_preview', 'operator')),
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (business_id, field_key, revision)
);

create index if not exists fact_revisions_business_idx on fact_revisions(business_id, field_key, revision desc);

-- Publish records: which site version went live, from which fact snapshot,
-- and the rollback pointer. site_versions already exist in bundle storage;
-- this records the publish event itself.
create table if not exists publish_records (
  id text primary key,
  site_id text not null,
  version_id text not null,
  fact_snapshot jsonb not null default '{}',
  risk_tier text not null default 'safe' check (risk_tier in ('safe', 'preview_approved', 'operator_approved')),
  published_by text not null,
  published_at timestamptz not null default now(),
  rolled_back_to text
);

create index if not exists publish_records_site_idx on publish_records(site_id, published_at desc);

alter table owner_audit_log enable row level security;
alter table fact_revisions enable row level security;
alter table publish_records enable row level security;
