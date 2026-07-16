-- Regenerable generation artifacts are intentionally discarded at the pre-launch cutover.
delete from site_artifacts;

alter table site_artifacts
  drop constraint if exists site_artifacts_scope_check,
  drop constraint if exists site_artifacts_artifact_type_check,
  drop column if exists producer_id,
  drop column if exists producer_version,
  drop column if exists vertical_playbook_version,
  drop column if exists section_contract_version,
  drop column if exists site_design_system_version,
  drop column if exists source_fact_ids,
  drop column if exists affected_page_id,
  drop column if exists affected_section_id,
  drop column if exists affected_slot_id,
  add column provenance_json jsonb not null,
  add constraint site_artifacts_scope_check
    check (scope in ('candidate_selected', 'site_selected', 'qa_evidence')),
  add constraint site_artifacts_artifact_type_check
    check (artifact_type in ('evidence_ledger', 'generation_plan', 'site_copy', 'generation_review', 'generation_failure', 'operator_decision'));
