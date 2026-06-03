-- Add generated-site V3 visual-layer artifact types.

alter table generation_artifacts
  drop constraint if exists generation_artifacts_artifact_type_check,
  add constraint generation_artifacts_artifact_type_check
    check (artifact_type in ('copy_artifact', 'copy_diff', 'business_context_report', 'change_impact_report', 'identity_reconcile_report', 'service_catalog_report', 'vertical_classification_report', 'conversion_path_report', 'information_architecture_report', 'brand_cue_report', 'brand_direction_report', 'brand_mark_generation_report', 'asset_selection_report', 'seo_metadata_report', 'performance_audit_report', 'social_proof_report', 'conversion_insights_report', 'local_seo_refresh_report', 'page_gap_analysis_report', 'experiment_recommendation_report', 'design_section_audit_report', 'design_system', 'blueprint', 'compiled_section', 'compiled_page', 'claim_report', 'policy_report', 'page_opportunity_report', 'visual_benchmark', 'art_direction_decision', 'media_asset_decision', 'copy_evaluation_report', 'v3_review_packet', 'generation_cost_report'));
