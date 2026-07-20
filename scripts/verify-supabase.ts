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
  "202607200014_retire_agentic_readiness.sql"
]) {
  const source = readFileSync(`supabase/migrations/${migration}`, "utf8");
  assert(source.trim().length > 40, `${migration} is missing or empty.`);
}

const client = getSupabaseAdminClient();
const checks = await Promise.all([
  count("sites"), count("business_states_v2"), count("site_intents_v2"), count("site_public_build_inputs"),
  count("site_workspace_revisions"), count("site_build_artifacts"), count("site_versions_v4"),
  count("site_agent_sessions"), count("site_agent_runs_v1"), count("site_operator_queue"),
  count("trusted_runtime_patches"), count("trusted_runtime_series"), count("trusted_runtime_promotion_audits"),
    count("vertical_demand_events_v1"), count("site_redirects_v1")
]);
process.stdout.write(`${JSON.stringify({ ok: true, tables: Object.fromEntries(checks) }, null, 2)}\n`);

async function count(table: string): Promise<[string, number]> {
  const column = table === "business_states_v2" ? "business_id" : "id";
  const { count: value, error } = await client.from(table).select(column, { count: "exact", head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return [table, value ?? 0];
}
