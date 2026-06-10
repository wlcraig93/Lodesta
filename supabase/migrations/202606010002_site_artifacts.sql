-- Store V2 generated-site artifacts outside candidate bundles.

create table if not exists site_artifacts (
  id text primary key,
  site_candidate_id text references site_candidates(id) on delete cascade,
  site_id text references sites(id) on delete cascade,
  scope text not null check (scope in ('candidate_selected', 'candidate_alternative', 'site_selected', 'site_alternative', 'evaluation_candidate', 'qa_evidence')),
  artifact_type text not null check (artifact_type in ('copy_artifact', 'copy_diff', 'business_context_report', 'change_impact_report', 'identity_reconcile_report', 'service_catalog_report', 'brand_cue_report', 'brand_direction_report', 'asset_selection_report', 'seo_metadata_report', 'design_system', 'blueprint', 'compiled_section', 'compiled_page', 'claim_report', 'policy_report', 'page_opportunity_report', 'visual_benchmark')),
  artifact_version text not null,
  producer_id text not null,
  producer_version text not null,
  vertical_playbook_version text,
  section_contract_version text,
  site_design_system_version text,
  source_fact_ids text[] not null default '{}',
  affected_page_id text,
  affected_section_id text,
  affected_slot_id text,
  content_hash text not null,
  payload_json jsonb not null,
  created_at timestamptz not null default now(),
  check (site_candidate_id is not null or site_id is not null)
);

create index if not exists site_artifacts_site_candidate_idx on site_artifacts(site_candidate_id, scope, artifact_type);
create index if not exists site_artifacts_site_idx on site_artifacts(site_id, scope, artifact_type);
create index if not exists site_artifacts_content_hash_idx on site_artifacts(content_hash);

alter table site_artifacts enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on site_artifacts to service_role;
