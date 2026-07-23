import "./load-env";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "../lib/supabase/client";

const migrationDirectory = "supabase/migrations";
const migrations = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
assert.deepEqual(
  migrations,
  ["202607230001_canonical_baseline.sql", "202607230002_typed_website_setup_failures.sql"],
  "The public schema must use the canonical baseline followed by the reviewed forward migrations."
);
const baseline = await readFile(`${migrationDirectory}/${migrations[0]}`, "utf8");
const typedFailures = await readFile(`${migrationDirectory}/${migrations[1]}`, "utf8");

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
  "claim_prospect_report_job", "bootstrap_site", "commit_verified_site_build", "promote_site_version"
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
  "agent_runs", "agent_run_spans", "agent_model_calls", "workspaces", "inquiry_deliveries",
  "website_setups_v1", "site_versions_v4", "business_states_v3", "site_intents_v3", "form_definitions_v2"
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
  "Legacy website crawl failures must be remapped to the canonical typed failure set."
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
  for (const table of requiredTables) {
    const { error } = await admin.from(table).select("*").limit(1);
    assert(!error, `${table}: ${error?.message}`);
  }
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
