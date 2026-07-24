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
    "202607230017_site_agent_run_admin_inventory.sql"
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
const modelRoutingTelemetry = await readFile(`${migrationDirectory}/${migrations[8]}`, "utf8");
const externalCodexAuthoring = await readFile(`${migrationDirectory}/${migrations[9]}`, "utf8");
const websiteAnalytics = await readFile(`${migrationDirectory}/${migrations[10]}`, "utf8");
const mediaOriginCleanCut = await readFile(`${migrationDirectory}/${migrations[11]}`, "utf8");
const canonicalMediaPublication = await readFile(`${migrationDirectory}/${migrations[12]}`, "utf8");
const canonicalAuthorityRefresh = await readFile(`${migrationDirectory}/${migrations[13]}`, "utf8");
const verifiedAuthoringFinalizerRefresh = await readFile(`${migrationDirectory}/${migrations[14]}`, "utf8");
const siteAgentRunawayGuardrails = await readFile(`${migrationDirectory}/${migrations[15]}`, "utf8");
const siteAgentRunAdminInventory = await readFile(`${migrationDirectory}/${migrations[16]}`, "utf8");
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
  assetRevisionScope.includes("asset_revisions_business_content_hash_idx")
    && assetRevisionScope.includes("business_id, content_hash"),
  "Asset revision content-hash uniqueness must remain scoped to its business."
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
    ...requiredTables.filter((table) => table !== "prospect_report_jobs"),
    "website_assessments",
    "website_assessment_jobs",
    "analytics_collection_daily"
  ];
  for (const table of liveTables) {
    const { error } = await admin.from(table).select("*").limit(1);
    assert(!error, `${table}: ${error?.message}`);
  }
  const { error: adminRunInventoryProbe } = await admin.from("site_agent_run_admin_inventory").select("id").limit(1);
  assert(!adminRunInventoryProbe, `site_agent_run_admin_inventory: ${adminRunInventoryProbe?.message}`);
  const { error: dispositionProbe } = await admin.rpc("dispose_owned_site", {
    target_site_id: "site_disposition_probe_missing",
    target_owner_user_id: "00000000-0000-0000-0000-000000000000"
  }).maybeSingle();
  assert(!dispositionProbe, `dispose_owned_site: ${dispositionProbe?.message}`);
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
