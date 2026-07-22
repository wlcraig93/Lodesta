import "./load-env";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getSupabaseAdminClient } from "../lib/supabase/client";

for (const migration of [
  "202607200001_agentic_site_platform_v1.sql",
  "202607200002_agentic_site_publish_rights_gate.sql",
  "202607200003_agentic_site_promotion_state.sql",
  "202607200004_agentic_site_test_cleanup.sql",
  "202607200005_atomic_verified_site_build.sql",
  "202607200006_operator_authority_reconciliation.sql",
  "202607200007_atomic_site_agent_run_claim.sql",
  "202607200008_atomic_prospect_report_job_claim.sql",
  "202607200009_agentic_readiness_test_cleanup.sql",
  "202607200010_vertical_demand_events.sql",
  "202607200011_atomic_site_bootstrap.sql",
  "202607200012_site_redirects_v1.sql",
  "202607200013_experimental_site_status.sql",
  "202607200014_retire_agentic_readiness.sql",
  "202607200015_experimental_cleanup_and_site_approvals.sql",
  "202607200016_publication_readiness_v1.sql",
  "202607200017_site_agent_observability_v1.sql",
  "202607200018_domain_neutral_generation_v1.sql",
  "202607200019_site_edit_objectives_v1.sql",
  "202607200020_final_legacy_generation_cleanup.sql",
  "202607200021_cost_optimized_sandbox_cutover.sql",
  "202607210001_site_v3_hard_cutover.sql"
]) {
  const source = readFileSync(`supabase/migrations/${migration}`, "utf8");
  assert(source.trim().length > 40, `${migration} is missing or empty.`);
}

const client = getSupabaseAdminClient();
const checks = await Promise.all([
  count("sites"), count("business_states_v3"), count("site_intents_v3"), count("site_public_build_inputs"),
  count("site_workspace_revisions"), count("site_build_artifacts"), count("site_versions_v4"),
  count("site_agent_sessions"), count("site_agent_runs_v2"), count("site_agent_trace_spans_v1"), count("site_edit_objectives_v1"), count("site_agent_maintenance_leases_v1"), count("site_operator_queue"),
  count("trusted_runtime_patches"), count("trusted_runtime_series"), count("trusted_runtime_promotion_audits"),
  count("vertical_demand_events_v1"), count("site_redirects_v1"), count("site_version_approvals_v1")
]);
const legacyTablesAbsent = await Promise.all([assertMissingRelation("generation_artifacts"), assertMissingRelation("site_generations")]);
const { error: telemetryError } = await client.from("site_agent_sessions")
  .select("sandbox_last_started_at,sandbox_last_destroyed_at,sandbox_provisioned_ms,sandbox_destroy_attempts").limit(1);
if (telemetryError) throw new Error(`site_agent_sessions telemetry: ${telemetryError.message}`);
const { data: activeLease, error: leaseError } = await client.rpc("site_agent_maintenance_active_v1", { task_name: `verify-${crypto.randomUUID()}` });
if (leaseError || activeLease !== false) throw new Error(`site_agent_maintenance_active_v1: ${leaseError?.message ?? "unexpected active result"}`);
process.stdout.write(`${JSON.stringify({ ok: true, tables: Object.fromEntries(checks), legacyTablesAbsent, durableCutoverLease: true, sandboxCostTelemetry: true }, null, 2)}\n`);

async function count(table: string): Promise<[string, number]> {
  const column = table === "business_states_v3" ? "business_id" : table === "site_agent_maintenance_leases_v1" ? "task" : "id";
  // PostgREST can return a misleading 204 for HEAD requests against a missing relation.
  // Fetch one row so schema-cache failures remain visible to this deployment check.
  const { count: value, error } = await client.from(table).select(column, { count: "exact" }).limit(1);
  if (error) throw new Error(`${table}: ${error.message}`);
  return [table, value ?? 0];
}

async function assertMissingRelation(table: string) {
  const { error } = await client.from(table).select("*").limit(1);
  if (!error) throw new Error(`${table}: retired relation still exists`);
  if (error.code !== "PGRST205") throw new Error(`${table}: expected missing-relation error PGRST205, received ${error.code ?? "unknown"}: ${error.message}`);
  return table;
}
