-- Add generated-site social proof report artifacts.

alter table site_artifacts
  drop constraint if exists site_artifacts_artifact_type_check,
  add constraint site_artifacts_artifact_type_check
    check (artifact_type in ('copy_artifact', 'copy_diff', 'business_context_report', 'change_impact_report', 'identity_reconcile_report', 'service_catalog_report', 'vertical_classification_report', 'conversion_path_report', 'information_architecture_report', 'brand_cue_report', 'brand_direction_report', 'asset_selection_report', 'seo_metadata_report', 'performance_audit_report', 'social_proof_report', 'design_system', 'blueprint', 'compiled_section', 'compiled_page', 'claim_report', 'policy_report', 'page_opportunity_report', 'visual_benchmark'));
