-- Add strategy report artifacts for vertical classification, conversion path, and information architecture.

alter table generation_artifacts
  drop constraint if exists generation_artifacts_artifact_type_check,
  add constraint generation_artifacts_artifact_type_check
    check (artifact_type in ('copy_artifact', 'copy_diff', 'business_context_report', 'change_impact_report', 'identity_reconcile_report', 'service_catalog_report', 'vertical_classification_report', 'conversion_path_report', 'information_architecture_report', 'brand_cue_report', 'brand_direction_report', 'asset_selection_report', 'seo_metadata_report', 'design_system', 'blueprint', 'compiled_section', 'compiled_page', 'claim_report', 'policy_report', 'page_opportunity_report', 'visual_benchmark'));
