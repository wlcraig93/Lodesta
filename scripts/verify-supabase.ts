import "./load-env";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "../lib/supabase/client";

const migrationDirectory = "supabase/migrations";
const migrations = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
assert.deepEqual(
  migrations,
  [
    "202607230001_canonical_baseline.sql",
    "202607230002_typed_website_setup_failures.sql",
    "202607230003_owner_site_disposition.sql",
    "202607230004_site_version_stale_status.sql",
    "202607230005_prospect_source_keys.sql",
    "202607230006_web_research_source_snapshots.sql",
    "202607230007_canonical_website_assessments.sql",
    "202607230008_asset_revision_business_scope.sql",
    "202607230009_site_agent_model_routing_telemetry.sql",
    "202607230010_external_codex_authoring.sql",
    "202607230011_canonical_website_analytics.sql",
    "202607230012_media_origin_clean_cut.sql",
    "202607230013_canonical_media_publication.sql",
    "202607230014_refresh_canonical_authority_functions.sql",
    "202607230015_refresh_verified_authoring_finalizer.sql",
    "202607230016_site_agent_runaway_guardrails.sql",
    "202607230017_site_agent_run_admin_inventory.sql",
    "202607230018_owner_account_overview.sql",
    "202607230019_site_authoring_maintenance_claim_fence.sql",
    "202607230020_website_setup_initial_model_experiment.sql",
    "202607250001_model_bakeoff.sql",
    "202607260001_source_unsuitable_website_setup_failure.sql",
    "202607260002_external_authoring_targeted_tools.sql",
    "202607260003_website_setup_managed_model.sql",
    "202607260004_prospect_report_access_policy.sql",
    "202607270001_website_health_report_v2.sql",
    "202607280001_generation_experiments.sql",
    "202607290001_normalized_prospect_research.sql",
    "202607300001_simplified_site_authoring.sql",
    "202607300002_owner_bound_website_setup_link.sql",
    "202607300003_site_agent_run_cancellation_fence.sql",
    "202607300004_durable_single_path_site_authoring.sql",
    "202607300005_remove_site_authoring_mcp.sql",
    "202607310001_comprehensive_site_ingestion.sql",
    "202607310002_targeted_site_agent_claim.sql",
    "202607310003_minimal_blue_green_sandboxes.sql",
    "202608010001_source_visual_references.sql",
    "202608010002_replayable_source_mirror.sql",
    "202608030001_luna_architecture_authoring.sql",
    "202608030002_bulk_website_source_snapshot.sql",
    "202608030003_staged_website_source_snapshot.sql",
    "202608030004_prospect_eligibility_inventory.sql",
    "202608030005_prospect_contact_provenance.sql",
    "202608030006_prospect_business_size_eligibility.sql",
    "202608030007_explainable_prospect_identity.sql",
    "202608040001_cross_source_prospect_identity.sql",
    "202608040002_simplify_prospect_research.sql",
    "202608040003_checkpointed_verification_and_luna_authoring.sql",
    "202608040004_verified_place_prospect_disposition.sql",
    "202608040005_incremental_source_snapshot_readiness.sql",
    "202608040006_minimal_prospect_gtm.sql",
    "202608040007_core_prospect_data_only.sql",
    "202608040008_business_locations_primary_contacts.sql",
    "202608040009_contact_identity_by_business_name.sql",
    "202608050001_owner_site_agent_run_cancellation.sql",
    "202608050002_prospect_places_no_result.sql",
    "202608050003_persist_google_place_candidate_data.sql",
    "202608080001_shared_retained_source_mirrors.sql",
    "202608140001_immutable_logo_preparation_revisions.sql",
    "202608140002_canonical_source_logo_recapture.sql",
    "202608230001_canonical_site_quality.sql"
  ],
  "The public schema must use the canonical baseline followed by the reviewed forward migrations."
);
const baseline = await readFile(`${migrationDirectory}/${migrations[0]}`, "utf8");
const typedFailures = await readFile(`${migrationDirectory}/${migrations[1]}`, "utf8");
const ownerSiteDisposition = await readFile(`${migrationDirectory}/${migrations[2]}`, "utf8");
const staleVersionStatus = await readFile(`${migrationDirectory}/${migrations[3]}`, "utf8");
const prospectSourceKeys = await readFile(`${migrationDirectory}/${migrations[4]}`, "utf8");
const webResearchSnapshots = await readFile(`${migrationDirectory}/${migrations[5]}`, "utf8");
const websiteAssessments = await readFile(`${migrationDirectory}/${migrations[6]}`, "utf8");
const assetRevisionScope = await readFile(`${migrationDirectory}/${migrations[7]}`, "utf8");
const immutableLogoPreparationRevisions = await readFile(`${migrationDirectory}/202608140001_immutable_logo_preparation_revisions.sql`, "utf8");
const canonicalSourceLogoRecapture = await readFile(`${migrationDirectory}/202608140002_canonical_source_logo_recapture.sql`, "utf8");
const modelRoutingTelemetry = await readFile(`${migrationDirectory}/${migrations[8]}`, "utf8");
const externalCodexAuthoring = await readFile(`${migrationDirectory}/${migrations[9]}`, "utf8");
const websiteAnalytics = await readFile(`${migrationDirectory}/${migrations[10]}`, "utf8");
const mediaOriginCleanCut = await readFile(`${migrationDirectory}/${migrations[11]}`, "utf8");
const canonicalMediaPublication = await readFile(`${migrationDirectory}/${migrations[12]}`, "utf8");
const sourceUnsuitableFailure = await readFile(`${migrationDirectory}/202607260001_source_unsuitable_website_setup_failure.sql`, "utf8");
const canonicalAuthorityRefresh = await readFile(`${migrationDirectory}/${migrations[13]}`, "utf8");
const verifiedAuthoringFinalizerRefresh = await readFile(`${migrationDirectory}/${migrations[14]}`, "utf8");
const siteAgentRunawayGuardrails = await readFile(`${migrationDirectory}/${migrations[15]}`, "utf8");
const siteAgentRunAdminInventory = await readFile(`${migrationDirectory}/${migrations[16]}`, "utf8");
const maintenanceClaimFence = await readFile(`${migrationDirectory}/${migrations[18]}`, "utf8");
const websiteSetupInitialModelExperiment = await readFile(`${migrationDirectory}/${migrations[19]}`, "utf8");
const modelBakeoff = await readFile(`${migrationDirectory}/${migrations[20]}`, "utf8");
const websiteSetupManagedModel = await readFile(`${migrationDirectory}/202607260003_website_setup_managed_model.sql`, "utf8");
const prospectReportAccessPolicy = await readFile(`${migrationDirectory}/202607260004_prospect_report_access_policy.sql`, "utf8");
const websiteHealthReportV2 = await readFile(`${migrationDirectory}/202607270001_website_health_report_v2.sql`, "utf8");
const canonicalSiteQuality = await readFile(`${migrationDirectory}/202608230001_canonical_site_quality.sql`, "utf8");
const generationExperiments = await readFile(`${migrationDirectory}/202607280001_generation_experiments.sql`, "utf8");
const normalizedProspectResearch = await readFile(`${migrationDirectory}/202607290001_normalized_prospect_research.sql`, "utf8");
const simplifiedSiteAuthoring = await readFile(`${migrationDirectory}/202607300001_simplified_site_authoring.sql`, "utf8");
const ownerBoundWebsiteSetupLink = await readFile(`${migrationDirectory}/202607300002_owner_bound_website_setup_link.sql`, "utf8");
const siteAgentRunCancellationFence = await readFile(`${migrationDirectory}/202607300003_site_agent_run_cancellation_fence.sql`, "utf8");
const durableSinglePathAuthoring = await readFile(`${migrationDirectory}/202607300004_durable_single_path_site_authoring.sql`, "utf8");
const removeSiteAuthoringMcp = await readFile(`${migrationDirectory}/202607300005_remove_site_authoring_mcp.sql`, "utf8");
const comprehensiveSiteIngestion = await readFile(`${migrationDirectory}/202607310001_comprehensive_site_ingestion.sql`, "utf8");
const minimalBlueGreenSandboxes = await readFile(`${migrationDirectory}/202607310003_minimal_blue_green_sandboxes.sql`, "utf8");
const replayableSourceMirror = await readFile(`${migrationDirectory}/202608010002_replayable_source_mirror.sql`, "utf8");
const lunaArchitectureAuthoring = await readFile(`${migrationDirectory}/202608030001_luna_architecture_authoring.sql`, "utf8");
const bulkWebsiteSourceSnapshot = await readFile(`${migrationDirectory}/202608030002_bulk_website_source_snapshot.sql`, "utf8");
const stagedWebsiteSourceSnapshot = await readFile(`${migrationDirectory}/202608030003_staged_website_source_snapshot.sql`, "utf8");
const prospectEligibilityInventory = await readFile(`${migrationDirectory}/202608030004_prospect_eligibility_inventory.sql`, "utf8");
const prospectContactProvenance = await readFile(`${migrationDirectory}/202608030005_prospect_contact_provenance.sql`, "utf8");
const prospectBusinessSizeEligibility = await readFile(`${migrationDirectory}/202608030006_prospect_business_size_eligibility.sql`, "utf8");
const explainableProspectIdentity = await readFile(`${migrationDirectory}/202608030007_explainable_prospect_identity.sql`, "utf8");
const crossSourceProspectIdentity = await readFile(`${migrationDirectory}/202608040001_cross_source_prospect_identity.sql`, "utf8");
const simplifiedProspectResearch = await readFile(`${migrationDirectory}/202608040002_simplify_prospect_research.sql`, "utf8");
const checkpointedVerification = await readFile(`${migrationDirectory}/202608040003_checkpointed_verification_and_luna_authoring.sql`, "utf8");
const verifiedPlaceProspectDisposition = await readFile(`${migrationDirectory}/202608040004_verified_place_prospect_disposition.sql`, "utf8");
const incrementalSourceSnapshotReadiness = await readFile(`${migrationDirectory}/202608040005_incremental_source_snapshot_readiness.sql`, "utf8");
const businessLocationsPrimaryContacts = await readFile(`${migrationDirectory}/202608040008_business_locations_primary_contacts.sql`, "utf8");
const contactIdentityByBusinessName = await readFile(`${migrationDirectory}/202608040009_contact_identity_by_business_name.sql`, "utf8");
const ownerSiteAgentRunCancellation = await readFile(`${migrationDirectory}/202608050001_owner_site_agent_run_cancellation.sql`, "utf8");
const prospectPlacesNoResult = await readFile(`${migrationDirectory}/202608050002_prospect_places_no_result.sql`, "utf8");
assert(
  businessLocationsPrimaryContacts.includes("add column business_email text")
    && businessLocationsPrimaryContacts.includes("add column is_primary boolean not null default false")
    && businessLocationsPrimaryContacts.includes("drop column location_id")
    && businessLocationsPrimaryContacts.includes("drop column status")
    && businessLocationsPrimaryContacts.includes("prospect_contacts_one_primary_idx")
    && businessLocationsPrimaryContacts.includes("primary_location.phone as location_phone")
    && businessLocationsPrimaryContacts.includes("as outreach_email")
    && businessLocationsPrimaryContacts.includes("as outreach_phone"),
  "Prospects must use the canonical business, locations, named contacts, and outreach projection."
);
assert(
  canonicalSiteQuality.includes(`assessment_json @> '{"schemaVersion": 1}'::jsonb`)
    && canonicalSiteQuality.includes(`assessment_json @> '{"schemaVersion": 2, "kind": "website-health-report"}'::jsonb`)
    && canonicalSiteQuality.includes(`assessment_json @> '{"schemaVersion": 3, "kind": "website-health-report"}'::jsonb`)
    && !/\bdelete\s+from\s+public\.website_assessments\b/i.test(canonicalSiteQuality)
    && !/\bupdate\s+public\.website_assessments\b/i.test(canonicalSiteQuality),
  "Canonical Site Quality must preserve retained assessment payloads and admit only the current report kind."
);
assert(
  contactIdentityByBusinessName.includes("create unique index prospect_contacts_business_name_idx")
    && contactIdentityByBusinessName.includes("prospect_id, lower(btrim(full_name))"),
  "Contact identity must be the normalized person name within a business."
);
assert(
  prospectPlacesNoResult.includes("'pending', 'matched', 'ambiguous', 'no_result', 'not_found'")
    && prospectPlacesNoResult.includes("prospects_research_state_check"),
  "Places no-result outcomes must be distinct from unsearched and web-researched prospects."
);
assert(
  verifiedPlaceProspectDisposition.includes("eligibility_status = 'review_required'")
    && verifiedPlaceProspectDisposition.includes("prospect.eligibility_status = 'eligible'")
    && verifiedPlaceProspectDisposition.includes("observation.location_id = location.id")
    && verifiedPlaceProspectDisposition.includes("observation.google_place_id = location.google_place_id")
    && verifiedPlaceProspectDisposition.includes("observation.evidence #>> '{placeIdLookup,status}' = 'found'")
    && verifiedPlaceProspectDisposition.includes("prospect.ownership_scope in ('independent_single_location', 'independent_multi_location')")
    && verifiedPlaceProspectDisposition.includes("prospect.location_research_status = 'confirmed_complete'")
    && !verifiedPlaceProspectDisposition.includes("delete from public.prospects"),
  "Verified-Place Keep disposition cutover or retained-data safety is incomplete."
);
assert(
  checkpointedVerification.includes("'siteAgentModel', 'gpt-5.6-luna'")
    && checkpointedVerification.includes("create or replace function public.checkpoint_site_agent_run_workspace")
    && checkpointedVerification.includes("create or replace function public.requeue_checkpointed_site_agent_run")
    && checkpointedVerification.includes("for update")
    && checkpointedVerification.includes("checkpoint_execution_fenced")
    && checkpointedVerification.includes("grant execute on function public.checkpoint_site_agent_run_workspace(jsonb,jsonb) to service_role")
    && checkpointedVerification.includes("grant execute on function public.requeue_checkpointed_site_agent_run(jsonb) to service_role"),
  "Verification checkpoints, same-run retry, or canonical Luna authoring migration is incomplete."
);
assert(
  simplifiedProspectResearch.includes("create table public.prospect_person_observations")
    && simplifiedProspectResearch.includes("add column location_id text")
    && simplifiedProspectResearch.includes("add column founded_year integer")
    && simplifiedProspectResearch.includes("drop column address_line_1")
    && simplifiedProspectResearch.includes("drop column phone")
    && simplifiedProspectResearch.includes("drop column priority_score")
    && simplifiedProspectResearch.includes("drop column target_fit_status")
    && simplifiedProspectResearch.includes("prospect_observations_verified_google_location_check")
    && simplifiedProspectResearch.includes("relationship_status")
    && !/delete\s+from\s+public\.prospects/i.test(simplifiedProspectResearch),
  "Prospect research must be business-first, location-bound, source-observed, and free of opaque persisted scores without deleting retained businesses."
);
assert(
  prospectEligibilityInventory.includes("add column eligibility_status")
    && prospectEligibilityInventory.includes("add column google_place_id")
    && prospectEligibilityInventory.includes("metadata->>'googlePlaceId'")
    && prospectEligibilityInventory.includes("add column disqualification_reason")
    && prospectEligibilityInventory.includes("prospects_disqualification_reason_consistency")
    && prospectEligibilityInventory.includes("'national_corporate_chain'")
    && prospectEligibilityInventory.includes("eligibility_policy_version")
    && prospectEligibilityInventory.includes("observation.review_rating as google_rating")
    && prospectEligibilityInventory.includes("observation.review_count as google_review_count")
    && prospectEligibilityInventory.includes("locations.google_place_id")
    && prospectEligibilityInventory.includes("as website_platform")
    && prospectEligibilityInventory.includes("as website_provider")
    && prospectEligibilityInventory.includes("as brand_name")
    && prospectEligibilityInventory.includes("as public_phone")
    && prospectEligibilityInventory.includes("prospects_eligibility_idx")
    && prospectEligibilityInventory.includes("prospect_locations_google_place_id_idx")
    && prospectEligibilityInventory.includes("drop index if exists public.prospect_contacts_phone_unique")
    && prospectEligibilityInventory.includes("prospect_contacts_phone_source_idx")
    && prospectEligibilityInventory.includes("as contact_details")
    && prospectEligibilityInventory.includes("'sourceUrl', contact.source_url")
    && !prospectEligibilityInventory.includes("delete from public.prospects"),
  "Prospect eligibility, chain disqualification, operator inventory projection, or safe retained-data backfill is incomplete."
);
assert(
  prospectContactProvenance.includes("add column source_provider")
    && prospectContactProvenance.includes("create table public.prospect_people")
    && prospectContactProvenance.includes("create table public.prospect_contact_points")
    && prospectContactProvenance.includes("create table public.prospect_contact_point_observations")
    && prospectContactProvenance.includes("create table public.prospect_organization_groups")
    && prospectContactProvenance.includes("create table public.prospect_organization_memberships")
    && prospectContactProvenance.includes("create view public.prospect_contact_details")
    && prospectContactProvenance.includes("drop table public.prospect_contacts")
    && prospectContactProvenance.includes("drop table public.prospect_affiliations")
    && prospectContactProvenance.includes("contact.source_provider")
    && prospectContactProvenance.includes("grant select, insert on table public.prospect_contact_point_observations to service_role"),
  "Prospect people, sourced contact points, organization groups, or their server-only access boundary is incomplete."
);
assert(
  prospectBusinessSizeEligibility.includes("'outside_target_business_size'")
    && prospectBusinessSizeEligibility.includes("active_location_count between 1 and 5")
    && prospectBusinessSizeEligibility.includes("active_location_count >= 6")
    && prospectBusinessSizeEligibility.includes("ownership_scope = 'regional_independent'")
    && prospectBusinessSizeEligibility.includes("eligibility_policy_version = 'lodesta-icp-v2'")
    && !prospectBusinessSizeEligibility.includes("delete from public.prospects"),
  "Prospect business-size policy or retained-data backfill is incomplete."
);
assert(
  explainableProspectIdentity.includes("add column location_research_status")
    && explainableProspectIdentity.includes("'agent_research'")
    && explainableProspectIdentity.includes("rename column verification_status to identity_match_status")
    && explainableProspectIdentity.includes("drop column verification_score")
    && explainableProspectIdentity.includes("drop column evidence_coverage")
    && explainableProspectIdentity.includes("add column observation_kind")
    && explainableProspectIdentity.includes("add column identity_match_basis jsonb")
    && explainableProspectIdentity.includes("add column google_business_name")
    && explainableProspectIdentity.includes("observation.observation_kind = 'google_business_profile'")
    && explainableProspectIdentity.includes("observation.observation_kind = 'business_website'")
    && !explainableProspectIdentity.includes("delete from public.prospects"),
  "Explainable prospect identity, separated observations, or retained-data migration safety is incomplete."
);
assert(
  crossSourceProspectIdentity.includes("add column identity_verification_level")
    && crossSourceProspectIdentity.includes("prospect_identity_basis_is_valid")
    && crossSourceProspectIdentity.includes("business_email_domain")
    && crossSourceProspectIdentity.includes("explained_stale")
    && crossSourceProspectIdentity.includes("cross_source_verified")
    && crossSourceProspectIdentity.includes("observation.identity_match_status = 'verified'")
    && crossSourceProspectIdentity.includes("observation.observation_kind = 'business_website'")
    && !crossSourceProspectIdentity.includes("delete from public.prospects"),
  "Cross-source prospect verification policy or retained-data migration safety is incomplete."
);
assert(
  replayableSourceMirror.includes("create table public.source_snapshot_resources")
    && replayableSourceMirror.includes("create table public.source_snapshot_pages")
    && replayableSourceMirror.includes("create or replace function public.save_website_source_snapshot")
    && replayableSourceMirror.includes("create or replace function public.search_source_snapshot_pages")
    && replayableSourceMirror.includes("create or replace function public.apply_prepared_source_recapture")
    && replayableSourceMirror.includes("source_snapshot_pages_search_idx")
    && replayableSourceMirror.includes("foreign key (source_snapshot_id, resource_id)")
    && replayableSourceMirror.includes("left(extracted_text, 500000)")
    && replayableSourceMirror.includes("drop table public.source_snapshot_chunks")
    && replayableSourceMirror.includes("drop table public.source_snapshot_objects")
    && replayableSourceMirror.includes("drop extension if exists vector")
    && !replayableSourceMirror.includes("embedding extensions"),
  "The replayable source mirror, atomic save/recapture, page-level full-text index, or derived-corpus removal is incomplete."
);
assert(
  lunaArchitectureAuthoring.includes("jsonb_set(value, '{siteAgentModel}', '\"gpt-5.6-luna\"', true)")
    && lunaArchitectureAuthoring.includes("value->>'siteAgentModel' = 'gpt-5.6-sol'"),
  "The canonical Luna authoring-model cutover is incomplete."
);
assert(
  bulkWebsiteSourceSnapshot.includes("create or replace function public.save_website_source_snapshot")
    && bulkWebsiteSourceSnapshot.includes("from jsonb_array_elements(resource_documents) as input(document)")
    && bulkWebsiteSourceSnapshot.includes("from jsonb_array_elements(page_documents) as input(document)")
    && bulkWebsiteSourceSnapshot.includes("left join public.source_snapshot_resources retained")
    && bulkWebsiteSourceSnapshot.includes("left join public.source_snapshot_pages retained")
    && bulkWebsiteSourceSnapshot.includes("pg_advisory_xact_lock")
    && bulkWebsiteSourceSnapshot.includes("website_source_snapshot_manifest_incomplete")
    && !bulkWebsiteSourceSnapshot.includes("for resource_document in")
    && !bulkWebsiteSourceSnapshot.includes("for page_document in"),
  "Website source-mirror persistence must use atomic bulk insertion and aggregate verification."
);
assert(
  stagedWebsiteSourceSnapshot.includes("create table public.website_source_snapshot_staging")
    && stagedWebsiteSourceSnapshot.includes("create table public.website_source_snapshot_staging_documents")
    && stagedWebsiteSourceSnapshot.includes("create or replace function public.begin_website_source_snapshot_staging")
    && stagedWebsiteSourceSnapshot.includes("create or replace function public.stage_website_source_snapshot_documents")
    && stagedWebsiteSourceSnapshot.includes("create or replace function public.finalize_staged_website_source_snapshot")
    && stagedWebsiteSourceSnapshot.includes("jsonb_array_length(documents) > 100")
    && stagedWebsiteSourceSnapshot.includes("website_source_snapshot_staging_incomplete")
    && stagedWebsiteSourceSnapshot.includes("website_source_snapshot_manifest_incomplete")
    && stagedWebsiteSourceSnapshot.includes("delete from public.website_source_snapshot_staging")
    && stagedWebsiteSourceSnapshot.includes("input.document->>'id'")
    && stagedWebsiteSourceSnapshot.includes("retained.document is distinct from input.document")
    && stagedWebsiteSourceSnapshot.includes("drop function public.save_website_source_snapshot(jsonb,jsonb,jsonb)"),
  "Large website mirrors must use bounded staging batches and atomic canonical finalization."
);
assert(
  incrementalSourceSnapshotReadiness.includes("add column ready_at timestamptz")
    && incrementalSourceSnapshotReadiness.includes("create or replace function public.begin_incremental_website_source_snapshot")
    && incrementalSourceSnapshotReadiness.includes("create or replace function public.complete_incremental_website_source_snapshot")
    && incrementalSourceSnapshotReadiness.includes("create trigger site_public_build_input_sources_require_ready")
    && incrementalSourceSnapshotReadiness.includes("public_build_input_source_not_ready")
    && incrementalSourceSnapshotReadiness.includes("website_source_snapshot_manifest_incomplete")
    && incrementalSourceSnapshotReadiness.includes("website_source_snapshot_staging_not_empty")
    && incrementalSourceSnapshotReadiness.includes("drop table public.website_source_snapshot_staging_documents")
    && incrementalSourceSnapshotReadiness.includes("drop table public.website_source_snapshot_staging"),
  "Large website mirrors must persist incrementally and remain unreadable until their complete manifest is ready."
);
assert(
  minimalBlueGreenSandboxes.includes("create table public.site_sandbox_deployments")
    && minimalBlueGreenSandboxes.includes("create table public.site_sandbox_control")
    && minimalBlueGreenSandboxes.includes("create table public.site_agent_workspace_checkpoints")
    && minimalBlueGreenSandboxes.includes("create function public.claim_site_agent_run")
    && minimalBlueGreenSandboxes.includes("drop function if exists public.claim_next_site_agent_run")
    && minimalBlueGreenSandboxes.includes("site-sandbox-control")
    && minimalBlueGreenSandboxes.includes("checkpoint_current")
    && minimalBlueGreenSandboxes.includes("pause_site_agent_run_for_input")
    && minimalBlueGreenSandboxes.includes("fence_expired_site_agent_session")
    && minimalBlueGreenSandboxes.includes("requeue_interrupted_site_agent_run")
    && minimalBlueGreenSandboxes.includes("save_site_agent_session_for_execution")
    && minimalBlueGreenSandboxes.includes("apply_managed_form_authoring_change")
    && minimalBlueGreenSandboxes.includes("public.finalize_verified_authoring(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure")
    && !minimalBlueGreenSandboxes.includes("public.finalize_verified_authoring(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure")
    && minimalBlueGreenSandboxes.includes("interval '5 minutes'")
    && minimalBlueGreenSandboxes.includes("cancel_site_agent_needs_input_run")
    && !minimalBlueGreenSandboxes.includes("sandboxWarmUntil")
    && !minimalBlueGreenSandboxes.includes("deployment_status"),
  "Blue-green deployment pointers, durable pause checkpoints, canonical claims, or teardown fencing are incomplete."
);
assert(
  ownerSiteAgentRunCancellation.includes("create or replace function public.cancel_site_agent_run")
    && ownerSiteAgentRunCancellation.includes("status in ('queued', 'running', 'needs_input')")
    && ownerSiteAgentRunCancellation.includes("'{executionNumber}'")
    && ownerSiteAgentRunCancellation.includes("status = 'cancelled'")
    && ownerSiteAgentRunCancellation.includes("error_code = 'owner_cancelled'")
    && ownerSiteAgentRunCancellation.includes("drop function public.cancel_site_agent_needs_input_run"),
  "Owner cancellation must atomically fence queued, running, and paused runs and close their open activity."
);
assert(
  comprehensiveSiteIngestion.includes("create table public.source_snapshot_objects")
    && comprehensiveSiteIngestion.includes("create table public.source_snapshot_chunks")
    && comprehensiveSiteIngestion.includes("create table public.site_version_source_coverage")
    && comprehensiveSiteIngestion.includes("create table public.site_version_redirects")
    && comprehensiveSiteIngestion.includes("create or replace function public.bind_site_version_source_migration")
    && comprehensiveSiteIngestion.includes("create or replace function public.search_source_snapshot_chunks")
    && comprehensiveSiteIngestion.includes("extensions.vector(1536)")
    && comprehensiveSiteIngestion.includes("on delete restrict")
    && comprehensiveSiteIngestion.includes("validate_site_version_redirects_before_publish")
    && comprehensiveSiteIngestion.includes("candidate_redirect_coverage_mismatch")
    && comprehensiveSiteIngestion.includes("candidate_source_coverage_missing")
    && comprehensiveSiteIngestion.includes("drop table public.vertical_demand_events"),
  "Complete source capture, hybrid retrieval, candidate coverage, redirect validation, or the catalog/vertical clean cut is missing."
);
assert(
  removeSiteAuthoringMcp.includes("remove_site_authoring_mcp_requires_reviewed_prelaunch_reset")
    && removeSiteAuthoringMcp.includes("drop table public.external_authoring_credential_requests")
    && removeSiteAuthoringMcp.includes("drop table public.external_authoring_credentials")
    && removeSiteAuthoringMcp.includes("drop table public.external_authoring_operations")
    && removeSiteAuthoringMcp.includes("drop table public.external_authoring_claims")
    && removeSiteAuthoringMcp.includes("drop table public.external_authoring_executions")
    && removeSiteAuthoringMcp.includes("drop table public.authoring_execution_bundles")
    && removeSiteAuthoringMcp.includes("drop table public.staged_blob_receipts")
    && removeSiteAuthoringMcp.includes("drop column execution_driver")
    && removeSiteAuthoringMcp.includes("invalid_site_agent_run_contract")
    && removeSiteAuthoringMcp.includes("create index site_agent_runs_claim_queue_idx")
    && removeSiteAuthoringMcp.includes("create view public.site_agent_run_admin_inventory"),
  "The MCP removal must fail loudly on retained rows and leave one canonical authoring queue, run contract, finalizer, and admin view."
);
assert(
  durableSinglePathAuthoring.includes("create unique index site_versions_one_candidate_idx")
    && durableSinglePathAuthoring.includes("where status = 'candidate'")
    && durableSinglePathAuthoring.includes("create unique index site_agent_runs_one_running_per_site_idx")
    && durableSinglePathAuthoring.includes("create index site_agent_runs_claim_queue_idx")
    && durableSinglePathAuthoring.includes("create or replace function public.bootstrap_site_authoring")
    && durableSinglePathAuthoring.includes("create or replace function public.claim_next_site_agent_run")
    && durableSinglePathAuthoring.includes("create table public.site_agent_continuation_heads")
    && durableSinglePathAuthoring.includes("create table public.site_agent_continuation_segments")
    && durableSinglePathAuthoring.includes("create or replace function public.apply_prepared_owner_authority_change")
    && durableSinglePathAuthoring.includes("drop table public.website_setups cascade")
    && durableSinglePathAuthoring.includes("drop table public.authoring_outbox")
    && durableSinglePathAuthoring.includes("prelaunch_site_authoring_reset_required"),
  "The durable single-path cutover must atomically bootstrap, claim, resume, and apply owner authority while removing setup and candidate-assessment queues."
);
assert(
  ownerBoundWebsiteSetupLink.includes("owner_user_id is null or owner_user_id = target_owner")
    && ownerBoundWebsiteSetupLink.includes("site_id = target_site_id")
    && ownerBoundWebsiteSetupLink.includes("session_id = target_session_id")
    && ownerBoundWebsiteSetupLink.includes("grant execute on function public.link_website_setup"),
  "Website setup linking must accept the same authenticated owner while rejecting cross-site session or run references."
);
assert(
  siteAgentRunCancellationFence.includes("create or replace function public.save_site_agent_run")
    && siteAgentRunCancellationFence.includes("create or replace function public.touch_site_agent_run_heartbeat")
    && siteAgentRunCancellationFence.includes("create or replace function public.claim_site_agent_run")
    && siteAgentRunCancellationFence.includes("'{heartbeatAt}'")
    && siteAgentRunCancellationFence.includes("current_run.status = 'queued'")
    && siteAgentRunCancellationFence.includes("site_agent_run_not_active")
    && siteAgentRunCancellationFence.includes("owner_user_id is not null")
    && siteAgentRunCancellationFence.includes("status <> 'paused'"),
  "Cancelled or disposed authoring runs are not fenced from stale worker updates and finalization."
);
assert(
  baseline.includes("origin text not null check (origin in ('source_website', 'owner_upload', 'platform_generated'))")
    && !baseline.includes("rights_status")
    && !baseline.includes("attestation jsonb"),
  "Canonical asset persistence must use typed origin without media-rights attestation columns."
);
assert(
  externalCodexAuthoring.includes("media_adoption_document")
    && externalCodexAuthoring.includes("stale_generated_media_adoption")
    && externalCodexAuthoring.includes("current_public_build_input_id")
    && !externalCodexAuthoring.includes("public_build_input_id = run_document->>'publicBuildInputId'"),
  "Verified finalization must atomically adopt generated media and its exact public build input."
);
assert(
  verifiedAuthoringFinalizerRefresh.includes("pg_get_functiondef(finalizer_signature)")
    && verifiedAuthoringFinalizerRefresh.includes("canonical_verified_authoring_finalizer_postcondition_failed")
    && verifiedAuthoringFinalizerRefresh.includes("run = run_document")
    && verifiedAuthoringFinalizerRefresh.includes(
      "revoke all on function public.finalize_verified_authoring"
    )
    && verifiedAuthoringFinalizerRefresh.includes(
      "grant execute on function public.finalize_verified_authoring"
    ),
  "The deployed verified-authoring finalizer repair or its service-role boundary is incomplete."
);
assert(
  siteAgentRunawayGuardrails.includes("run - 'limits'")
    && siteAgentRunawayGuardrails.includes("'maxCostUsd'")
    && siteAgentRunawayGuardrails.includes("'maxConsecutiveIdenticalFailures'")
    && siteAgentRunawayGuardrails.includes("site_agent_runaway_guardrail_cutover_failed"),
  "The site-agent runaway-guardrail clean cut must remove token limits and verify canonical guardrails."
);
assert(
  siteAgentRunAdminInventory.includes("create or replace view public.site_agent_run_admin_inventory")
    && siteAgentRunAdminInventory.includes("with (security_invoker = true)")
    && !siteAgentRunAdminInventory.includes("  runs.run,\n")
    && siteAgentRunAdminInventory.includes("left join public.sites")
    && siteAgentRunAdminInventory.includes("end as cost_usd")
    && siteAgentRunAdminInventory.includes("end as duration_ms")
    && siteAgentRunAdminInventory.includes("end as token_count")
    && siteAgentRunAdminInventory.includes("as search_text")
    && siteAgentRunAdminInventory.includes("revoke all on table public.site_agent_run_admin_inventory from public, anon, authenticated")
    && siteAgentRunAdminInventory.includes("grant select on table public.site_agent_run_admin_inventory to service_role"),
  "The admin run inventory must be a service-role-only security-invoker view with safe numeric projections."
);
assert(
  maintenanceClaimFence.includes("site-authoring-maintenance-claim-fence")
    && maintenanceClaimFence.includes("task = 'site_authoring_maintenance'")
    && maintenanceClaimFence.includes("e.status in ('claimed','authoring','finalizing')")
    && !maintenanceClaimFence.includes("workspace-cutover"),
  "The canonical maintenance lease must atomically fence new ordinary and external claims while allowing active executions to finish."
);
assert(
  websiteSetupInitialModelExperiment.includes("initial_build_api_provider")
    && websiteSetupInitialModelExperiment.includes("target_initial_build_api_provider")
    && websiteSetupInitialModelExperiment.includes("initial_build_model_id")
    && websiteSetupInitialModelExperiment.includes("target_initial_build_model_id")
    && websiteSetupInitialModelExperiment.includes("invalid_initial_build_route")
    && websiteSetupInitialModelExperiment.includes("initial_build_api_provider = 'openrouter'")
    && websiteSetupInitialModelExperiment.includes("initial_build_model_id ~"),
  "The temporary initial-build model experiment must retain and validate exact OpenRouter route provenance."
);
assert(
  websiteSetupManagedModel.includes("drop column initial_build_api_provider")
    && websiteSetupManagedModel.includes("drop column initial_build_model_id")
    && websiteSetupManagedModel.includes("prospect_report_id text references public.prospect_reports(id) on delete restrict")
    && websiteSetupManagedModel.includes("target_prospect_report_id"),
  "Owner onboarding must remove customer model choice and retain report attribution."
);
assert(
  prospectReportAccessPolicy.includes("access_policy text")
    && prospectReportAccessPolicy.includes("check (access_policy in ('email_gate', 'public_link'))")
    && prospectReportAccessPolicy.includes("create table public.prospect_report_access_grants")
    && prospectReportAccessPolicy.includes("token_hash text not null unique")
    && prospectReportAccessPolicy.includes("prospect_report_access_grants_report_expiry_idx")
    && prospectReportAccessPolicy.includes("prospect_reports_active_source_policy_unique")
    && prospectReportAccessPolicy.includes("prospect_report_leads_report_email_unique")
    && prospectReportAccessPolicy.includes("on conflict (report_id, lower(email))")
    && prospectReportAccessPolicy.includes("drop column unlocked_at")
    && prospectReportAccessPolicy.includes("drop column lead_id"),
  "Visitor-specific report access must replace report-global unlock state with indexed, expiring grants and case-insensitive lead reuse."
);
assert(
  prospectReportAccessPolicy.includes("report_id text references public.prospect_reports(id) on delete restrict")
    && prospectReportAccessPolicy.includes("first_report_viewed_at timestamptz")
    && prospectReportAccessPolicy.includes("'report_viewed'")
    && prospectReportAccessPolicy.includes("create or replace function public.record_outbound_report_view")
    && prospectReportAccessPolicy.includes("and first_report_viewed_at is null")
    && prospectReportAccessPolicy.includes("revoke all on function public.record_outbound_report_view")
    && prospectReportAccessPolicy.includes("grant execute on function public.record_outbound_report_view"),
  "Outbound reports must attach with delete-restrict semantics and record the first completed view atomically through a server-only function."
);
assert(
  prospectReportAccessPolicy.includes("alter table public.prospect_report_access_grants enable row level security")
    && prospectReportAccessPolicy.includes("revoke all on table public.prospect_report_access_grants from public, anon, authenticated")
    && prospectReportAccessPolicy.includes("grant select, insert, update, delete on table public.prospect_report_access_grants to service_role")
    && prospectReportAccessPolicy.includes("revoke all on function public.create_or_reuse_prospect_report_lead")
    && prospectReportAccessPolicy.includes("grant execute on function public.create_or_reuse_prospect_report_lead"),
  "Report grants and access authorities must remain service-role-only with no browser policies."
);
assert(
  modelBakeoff.includes("create table public.model_bakeoff_experiments")
    && modelBakeoff.includes("create table public.model_bakeoff_runs")
    && modelBakeoff.includes("candidate_version_id text references public.site_versions(id) on delete restrict")
    && modelBakeoff.includes("assessment_id text references public.website_assessments(id) on delete restrict")
    && modelBakeoff.includes("enable row level security")
    && modelBakeoff.includes("revoke all on table public.model_bakeoff_experiments from public, anon, authenticated"),
  "The operator-only model bake-off must retain candidate provenance and use the server-only database boundary."
);
assert(
  generationExperiments.includes("create table public.generation_experiments")
    && generationExperiments.includes("create table public.generation_experiment_runs")
    && generationExperiments.includes("schema_version integer not null check (schema_version = 2)")
    && generationExperiments.includes("variant_key text not null")
    && generationExperiments.includes("replicate integer not null check (replicate between 1 and 4)")
    && generationExperiments.includes("candidate_version_id text references public.site_versions(id) on delete restrict")
    && generationExperiments.includes("assessment_id text references public.website_assessments(id) on delete restrict")
    && generationExperiments.includes("enable row level security")
    && generationExperiments.includes("revoke all on table public.generation_experiments from public, anon, authenticated"),
  "Generation experiments must retain process, replicate, candidate, and assessment provenance behind the server-only boundary."
);
assert(
  normalizedProspectResearch.includes("create table public.prospects")
    && normalizedProspectResearch.includes("create table public.prospect_observations")
    && normalizedProspectResearch.includes("create table public.prospect_contacts")
    && normalizedProspectResearch.includes("unique (prospect_id, input_hash)")
    && normalizedProspectResearch.includes("verification_status text not null default 'unverified'")
    && normalizedProspectResearch.includes("operating_status text not null default 'unknown'")
    && normalizedProspectResearch.includes("target_fit_status text not null default 'unknown'")
    && normalizedProspectResearch.includes("prospect_observations_verification_filters_idx")
    && normalizedProspectResearch.includes("'public_listing'")
    && normalizedProspectResearch.includes("with (security_invoker = true)")
    && normalizedProspectResearch.includes("add column prospect_id text")
    && normalizedProspectResearch.includes("add column selection_observation_id text")
    && normalizedProspectResearch.includes("drop column business_name")
    && normalizedProspectResearch.includes("drop column vertical")
    && normalizedProspectResearch.includes("drop column source_url"),
  "Prospect research must separate canonical business identity, immutable observations, sourced contacts, verification/fit status, and campaign membership."
);
assert(
  simplifiedSiteAuthoring.includes("simplified_site_authoring_requires_reviewed_prelaunch_reset")
    && simplifiedSiteAuthoring.includes("rename column business_state_revision to owner_operational_revision")
    && simplifiedSiteAuthoring.includes("rename column site_intent_revision to owner_intent_revision")
    && simplifiedSiteAuthoring.includes("add column owner_user_id uuid not null")
    && simplifiedSiteAuthoring.includes("add column site_id text not null references public.sites")
    && simplifiedSiteAuthoring.includes("owner_user_id::text = actor_id")
    && simplifiedSiteAuthoring.includes("owner_authority_changed")
    && simplifiedSiteAuthoring.includes("intent->>'ownerIntentRevision'")
    && simplifiedSiteAuthoring.includes("runtime_patch.security_status = 'audited'")
    && simplifiedSiteAuthoring.includes("drop table public.external_authoring_batches")
    && simplifiedSiteAuthoring.includes("drop table public.generation_experiments")
    && simplifiedSiteAuthoring.includes("drop table public.model_bakeoff_experiments")
    && !simplifiedSiteAuthoring.includes("regexp_replace("),
  "The simplified authoring cut must enforce reviewed reset, retained candidate integrity, owner authority, and clean experiment removal."
);
assert(
  normalizedProspectResearch.includes("where do_not_contact")
    && normalizedProspectResearch.includes("where outreach_eligible and suppressed_at is null")
    && normalizedProspectResearch.includes("check (not outreach_eligible or verification_status in ('public_source', 'owner_verified'))")
    && normalizedProspectResearch.includes("revoke all on table public.prospects from public, anon, authenticated")
    && normalizedProspectResearch.includes("grant select, insert on table public.prospect_observations to service_role")
    && !normalizedProspectResearch.includes("grant select, insert, update, delete on table public.prospect_observations"),
  "Prospect contacts and observations must preserve suppression, verification, and append-only server boundaries."
);
const prospectSnapshotPruneFunction = normalizedProspectResearch.match(
  /create or replace function public\.prune_prospect_source_snapshot[\s\S]*?\n\$\$;/i
)?.[0];
assert(
  prospectSnapshotPruneFunction
    && prospectSnapshotPruneFunction.includes("security definer")
    && prospectSnapshotPruneFunction.includes("set search_path = ''")
    && prospectSnapshotPruneFunction.includes("metadata ->> 'acquisitionSource'")
    && prospectSnapshotPruneFunction.includes("from public.outbound_prospects")
    && prospectSnapshotPruneFunction.includes("website_assessment_id is not null")
    && prospectSnapshotPruneFunction.includes("prospect_report_id is not null"),
  "Source-snapshot pruning must be scoped by acquisition source and fail closed for selected, assessed, or reported prospects."
);
assert(
  !/\bdelete\s+from\s+public\.(prospects|prospect_observations|prospect_contacts|outbound_prospects)\b/i.test(
    normalizedProspectResearch.replace(prospectSnapshotPruneFunction, "")
  ),
  "The prospect normalization cutover must backfill retained records without deleting them."
);
assert(
  websiteAnalytics.includes("drop table public.analytics_events")
    && websiteAnalytics.includes("unique (site_id, event_id)")
    && websiteAnalytics.includes("create function public.analytics_report")
    && websiteAnalytics.includes("create table public.analytics_collection_daily")
    && websiteAnalytics.includes("reporting_timezone")
    && websiteAnalytics.includes("target_reporting_timezone")
    && websiteAnalytics.includes("p_source text")
    && !websiteAnalytics.includes("'Direct / unknown'"),
  "Canonical website analytics schema, reporting, diagnostics, or timezone storage is incomplete."
);
assert(
  mediaOriginCleanCut.includes("media_origin_cutover_requires_empty_authorities")
    && mediaOriginCleanCut.includes("alter column origin set not null")
    && mediaOriginCleanCut.includes("alter column provenance set not null")
    && mediaOriginCleanCut.includes("drop column if exists rights_status")
    && mediaOriginCleanCut.includes("drop column if exists attestation"),
  "The pre-launch media-origin hard cut must reject retained authorities and remove the retired rights columns."
);
assert(
  canonicalMediaPublication.includes("canonical_media_publication_requires_empty_external_batches")
    && canonicalMediaPublication.includes("drop column if exists reference_asset_preview_policy_accepted_at")
    && canonicalMediaPublication.includes("create or replace function public.promote_site_version")
    && !canonicalMediaPublication.includes("asset.reference_only"),
  "The canonical media publication cut must remove external approval state and media-specific publication blocking."
);
const refreshedBootstrap = functionBody(canonicalAuthorityRefresh, "bootstrap_site");
const refreshedDisposition = functionBody(canonicalAuthorityRefresh, "dispose_owned_site");
assert(
  refreshedBootstrap.includes("origin, provenance")
    && refreshedBootstrap.includes("item->>'origin'")
    && refreshedBootstrap.includes("item->'provenance'")
    && !refreshedBootstrap.includes("rights_status")
    && !refreshedBootstrap.includes("rightsStatus")
    && !refreshedBootstrap.includes("attestation"),
  "The refreshed bootstrap authority must persist typed media origin without retired rights permissioning."
);
assert(
  refreshedDisposition.includes("update preview_grants")
    && !refreshedDisposition.includes("preview_tokens"),
  "The refreshed owner disposition authority must revoke preview grants without the retired raw-token table."
);
assert(
  canonicalAuthorityRefresh.includes("drop function if exists public.commit_verified_site_build(jsonb,jsonb)")
    && canonicalAuthorityRefresh.includes("canonical_bootstrap_site_postcondition_failed")
    && canonicalAuthorityRefresh.includes("canonical_dispose_owned_site_postcondition_failed")
    && canonicalAuthorityRefresh.includes("revoke all on function public.bootstrap_site")
    && canonicalAuthorityRefresh.includes("revoke all on function public.dispose_owned_site"),
  "The authority refresh must remove the legacy finalizer, verify postconditions, and preserve service-role-only execution."
);

const requiredTables = [
  "businesses", "sites", "business_states", "site_intents", "source_snapshots", "asset_revisions",
  "form_definitions", "site_public_build_inputs", "site_workspace_revisions", "site_build_artifacts",
  "site_versions", "site_agent_sessions", "site_agent_runs", "website_setups", "adoption_invitations",
  "domains", "active_domains", "prospect_reports", "prospect_report_leads", "prospect_report_jobs"
];
for (const table of requiredTables) {
  assert(new RegExp(`create table ${table}\\s*\\(`).test(baseline), `Canonical table ${table} is missing.`);
  assert(baseline.includes(`'${table}'`), `${table} is missing from the RLS/privilege loop.`);
}
const declaredTables = [...baseline.matchAll(/^create table ([a-z0-9_]+)\s*\(/gm)].map((match) => match[1]).sort();
const rlsLoop = baseline.match(/foreach table_name in array array\[(.*?)\]\s*loop/s)?.[1] ?? "";
const protectedTables = [...rlsLoop.matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]).sort();
assert.deepEqual(protectedTables, declaredTables, "Every application table must be present exactly once in the server-only RLS/privilege loop.");
const requiredFunctions = [
  "create_website_setup", "enqueue_site_agent_run", "link_website_setup", "claim_next_website_setup",
  "cancel_website_setup", "update_website_setup_source", "retry_website_setup",
  "claim_site_agent_run", "claim_domain_ownership", "consume_adoption_invitation",
  "claim_prospect_report_job", "bootstrap_site", "promote_site_version"
];
const declaredFunctions = [...baseline.matchAll(/^create function ([a-z0-9_]+)\s*\(/gm)].map((match) => match[1]).sort();
const browserRevokedFunctions = [...baseline.matchAll(/^revoke all on function ([a-z0-9_]+)\s*\(/gm)].map((match) => match[1]).sort();
assert.deepEqual(browserRevokedFunctions, declaredFunctions, "Every application function must be revoked from browser roles.");
for (const name of requiredFunctions) {
  assert(new RegExp(`create function ${name}\\s*\\(`).test(baseline), `Canonical function ${name} is missing.`);
  assert(baseline.includes(`revoke all on function ${name}(`), `${name} is not revoked from browser roles.`);
}
for (const retired of [
  "claims", "jobs", "site_version_approvals", "worker_heartbeats", "experiments", "experiment_learnings",
  "agent_runs", "agent_run_spans", "agent_model_calls", "workspaces", "inquiry_deliveries"
]) {
  assert(!new RegExp(`create table ${retired}\\s*\\(`).test(baseline), `Retired table ${retired} remains in the baseline.`);
}
assert(baseline.includes("owner_user_id uuid references auth.users(id) on delete restrict"), "Direct site ownership FK is missing.");
assert(baseline.includes("website_setups_owner_source_idx") && !baseline.includes("unique index website_setups_owner_source"), "Source detection must be non-unique and account-scoped.");
assert(baseline.includes("pg_advisory_xact_lock") && baseline.includes("private_user_active_operation_count"), "Combined capacity is not transactionally enforced.");
assert(baseline.includes("hashtextextended('site-agent-global-capacity', 0)"), "Global authoring capacity is not claimed atomically.");
assert(baseline.includes("enable row level security") && baseline.includes("revoke all on table %I from public, anon, authenticated"), "Server-only RLS posture is missing.");
assert(baseline.includes("revoke all on schema public from public, anon, authenticated"), "Browser roles retain public-schema privileges.");
assert(
  typedFailures.includes("failure_code = 'crawl_temporarily_unavailable'")
    && !baseline.includes("'website_crawl_failed'"),
  "Retired website crawl failures must be remapped to the canonical typed failure set."
);
assert(
  sourceUnsuitableFailure.includes("'source_unsuitable'"),
  "Closed or parked first-party sources do not have a canonical setup failure."
);
assert(
  assetRevisionScope.includes("asset_revisions_business_content_hash_idx")
    && assetRevisionScope.includes("business_id, content_hash")
    && baseline.includes("create index asset_revisions_business_content_hash_idx")
    && !baseline.includes("create unique index asset_revisions_business_content_hash_idx")
    && immutableLogoPreparationRevisions.includes("drop index if exists public.asset_revisions_business_content_hash_idx")
    && immutableLogoPreparationRevisions.includes("create index asset_revisions_business_content_hash_idx"),
  "Asset revision content-hash lookup must remain business-scoped without conflating byte identity and immutable revision provenance."
);
assert(
  canonicalSourceLogoRecapture.includes("asset_documents jsonb")
    && canonicalSourceLogoRecapture.includes("state_document jsonb")
    && canonicalSourceLogoRecapture.includes("source_recapture_asset_scope_mismatch"),
  "Source recapture must atomically advance the canonical logo and mutable business authority."
);
assert(
  modelRoutingTelemetry.includes("add column api_provider text")
    && modelRoutingTelemetry.includes("cost_usd numeric(20, 10)")
    && modelRoutingTelemetry.includes("site_agent_run_events_run_sequence_idx")
    && modelRoutingTelemetry.includes("run_document->>'apiProvider'")
    && modelRoutingTelemetry.includes("jsonb_set(value, '{siteAgentProvider}', '\"openai\"', true)"),
  "Site-agent provider routing and per-turn cost telemetry migration is incomplete."
);
assert(
  ownerSiteDisposition.includes("create or replace function dispose_owned_site")
    && ownerSiteDisposition.includes("owner_user_id = target_owner_user_id")
    && ownerSiteDisposition.includes("status = 'paused', owner_user_id = null"),
  "Owner site disposition is not atomic and owner-scoped."
);
assert(
  ownerSiteDisposition.includes("revoke all on function dispose_owned_site(text,uuid) from public, anon, authenticated")
    && ownerSiteDisposition.includes("grant execute on function dispose_owned_site(text,uuid) to service_role"),
  "Owner site disposition is not restricted to the service role."
);
assert(
  staleVersionStatus.includes("add column if not exists stale_reason text")
    && staleVersionStatus.includes("'stale'")
    && staleVersionStatus.includes("status in ('candidate', 'superseded')")
    && !staleVersionStatus.includes("status in ('candidate', 'stale', 'superseded')"),
  "Stale site versions must be retained but never promotable."
);
assert(
  prospectSourceKeys.includes("rename column place_id to source_key")
    && prospectSourceKeys.includes("resolution_usage jsonb")
    && prospectSourceKeys.includes("prospect_reports_source_key_idx"),
  "Prospect reports must use source keys and retain paid-resolution usage."
);
assert(
  webResearchSnapshots.includes("'web_research'")
    && !webResearchSnapshots.includes("'google_places'"),
  "Source snapshots must use web research rather than Google Places."
);
assert(
  websiteAssessments.includes("create table public.website_assessments")
    && websiteAssessments.includes("create table public.website_assessment_jobs")
    && websiteAssessments.includes("for update skip locked")
    && websiteAssessments.includes("drop table public.prospect_report_jobs")
    && websiteAssessments.includes("enable row level security"),
  "The canonical website-assessment cutover is incomplete."
);
assert(
  websiteHealthReportV2.includes(`assessment_json @> '{"schemaVersion": 1}'::jsonb`)
    && websiteHealthReportV2.includes(`assessment_json @> '{"schemaVersion": 2, "kind": "website-health-report"}'::jsonb`)
    && !/\bdelete\s+from\s+public\.website_assessments\b/i.test(websiteHealthReportV2)
    && !/\bupdate\s+public\.website_assessments\b/i.test(websiteHealthReportV2),
  "Website Health v2 must preserve retained v1 payloads and admit only the canonical v2 report kind."
);
const businessesBody = baseline.match(/create table businesses\s*\((.*?)\n\);/s)?.[1] ?? "";
const businessColumns = [...businessesBody.matchAll(/^\s{2}([a-z_]+)\s/gm)].map((match) => match[1]);
assert.deepEqual(
  businessColumns,
  ["id", "name", "vertical", "created_at", "updated_at"],
  "businesses must remain a minimal human-readable identity and foreign-key anchor."
);

if (process.env.LODESTA_VERIFY_LIVE_DATABASE === "true") {
  const admin = getSupabaseAdminClient();
  const liveTables = [
    ...requiredTables.filter((table) => !["prospect_report_jobs", "website_setups"].includes(table)),
    "website_assessments",
    "website_assessment_jobs",
    "site_authoring_bootstrap_requests",
    "site_agent_continuation_heads",
    "site_agent_continuation_segments",
    "analytics_collection_daily",
    "prospect_report_access_grants",
    "prospects",
    "prospect_locations",
    "prospect_contacts"
  ];
  for (const table of liveTables) {
    const { error } = await admin.from(table).select("*").limit(1);
    assert(!error, `${table}: ${error?.message}`);
  }
  const { error: adminRunInventoryProbe } = await admin.from("site_agent_run_admin_inventory").select("id").limit(1);
  assert(!adminRunInventoryProbe, `site_agent_run_admin_inventory: ${adminRunInventoryProbe?.message}`);
  const { error: prospectCurrentProbe } = await admin.from("prospect_current").select("id").limit(1);
  assert(!prospectCurrentProbe, `prospect_current: ${prospectCurrentProbe?.message}`);
  const { error: dispositionProbe } = await admin.rpc("dispose_owned_site", {
    target_site_id: "site_disposition_probe_missing",
    target_owner_user_id: "00000000-0000-0000-0000-000000000000"
  }).maybeSingle();
  assert(!dispositionProbe, `dispose_owned_site: ${dispositionProbe?.message}`);
  const { data: outboundReportViewProbe, error: outboundReportViewError } = await admin.rpc(
    "record_outbound_report_view",
    {
      target_report_id: "prospect_report_live_probe_missing",
      target_occurred_at: new Date().toISOString()
    }
  );
  assert(!outboundReportViewError, `record_outbound_report_view: ${outboundReportViewError?.message}`);
  assert.equal(outboundReportViewProbe, false, "Missing outbound reports must not record a view.");
  const { error: reportAccessPolicyProbe } = await admin
    .from("prospect_reports")
    .select("id,access_policy")
    .limit(1);
  assert(!reportAccessPolicyProbe, `prospect_reports access_policy: ${reportAccessPolicyProbe?.message}`);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  assert(url && anonKey, "Public Supabase Auth configuration is required for browser-role denial verification.");
  const browser = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: anonRead } = await browser.from("sites").select("id").limit(1);
  assert(anonRead, "The anon role unexpectedly read an application table.");
  const { error: anonWrite } = await browser.from("sites").insert({ id: "forbidden" });
  assert(anonWrite, "The anon role unexpectedly mutated an application table.");
}

console.log(JSON.stringify({
  ok: true,
  migrations,
  tables: declaredTables.length,
  functions: declaredFunctions.length,
  live: process.env.LODESTA_VERIFY_LIVE_DATABASE === "true"
}));

function functionBody(sql: string, name: string) {
  const match = sql.match(new RegExp(
    `create or replace function (?:public\\.)?${name}\\s*\\([\\s\\S]*?\\)\\s*returns[\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`,
    "i"
  ));
  assert(match?.[1], `Migration is missing the ${name} function body.`);
  return match[1];
}
