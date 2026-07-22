import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isConfirmedSandboxAbsent, SiteSandboxClient, SiteSandboxRequestError } from "../packages/site-sandbox/client";

const migrationPath = "supabase/migrations/202607210001_site_v3_hard_cutover.sql";
const cutoverPath = "scripts/site-v3-cutover.ts";
const snapshotPath = "scripts/snapshot-site-v3-database.ts";
const reclassificationMigrationPath = "supabase/migrations/202607210000_prelaunch_site_v3_reclassification.sql";
const reclassificationPath = "scripts/reclassify-prelaunch-site-v3.ts";
const traceReconciliationPath = "scripts/reconcile-cutover-trace-payloads.ts";
const [migration, cutover, snapshot, reclassificationMigration, reclassification, traceReconciliation] = await Promise.all([
  readFile(migrationPath, "utf8"),
  readFile(cutoverPath, "utf8"),
  readFile(snapshotPath, "utf8"),
  readFile(reclassificationMigrationPath, "utf8"),
  readFile(reclassificationPath, "utf8"),
  readFile(traceReconciliationPath, "utf8")
]);

assert(!/\bdelete\s+from\b/i.test(migration), "the assert-empty migration must never delete retained data");
for (const authority of [
  "sites",
  "business_states_v3",
  "site_intents_v2",
  "site_public_build_inputs",
  "site_workspace_revisions",
  "site_build_artifacts",
  "site_versions_v4"
]) {
  assert(migration.includes(`select 1 from ${authority}`), `migration does not assert that ${authority} is empty`);
}
for (const requirement of [
  "reconcile-missing-trace-payloads:",
  "site-v3-trace-reconciliation-request-v1",
  "site-v3-trace-reconciliation-receipt-v1",
  "startsWith(`trace-payloads/${options.agentRunId}/`)",
  "span.exists",
  "payload_ref: null",
  "assertQuiescent()",
  "original cutover database snapshot",
  "report.json"
]) {
  assert(traceReconciliation.includes(requirement), `trace payload reconciliation operator is missing: ${requirement}`);
}
assert(migration.includes("alter table site_intents_v2 rename to site_intents_v3"));
assert(migration.includes("schema_version = 'site-intent-v3'"));
assert(migration.includes("schema_version = 'site-public-build-input-v3'"));
assert(migration.includes("pg_get_functiondef(p.oid) like '%site_intents_v2%'"), "stored database functions are not cut over to the V3 relation");
assert(migration.includes("drop function if exists reclassify_prelaunch_draft_site_for_v3_cutover_v1"), "one-time reclassification authority survives the hard cutover");

for (const requirement of [
  "pg_advisory_xact_lock",
  "workspace_storage_cutover",
  "status in ('queued', 'running')",
  "target.status <> 'draft'",
  "target.workspace_id is not null",
  "target.published_version_id is not null",
  "exists (select 1 from domains",
  "exists (select 1 from claims",
  "exists (select 1 from inquiries",
  "exists (select 1 from preview_tokens",
  "status = 'published'",
  "set status = 'experimental'",
  "revoke all",
  "grant execute"
]) {
  assert(reclassificationMigration.includes(requirement), `pre-launch reclassification migration is missing: ${requirement}`);
}
for (const requirement of [
  "reclassify-prelaunch-draft:",
  "site-v3-prelaunch-reclassification-request-v1",
  "site-v3-prelaunch-reclassification-receipt-v1",
  "original pre-reclassification database snapshot",
  "assertQuiescent()",
  "assertDisposableDraft(footprint)",
  "report.json",
  "docs/cutovers/site-v3-"
]) {
  assert(reclassification.includes(requirement), `pre-launch reclassification operator is missing: ${requirement}`);
}

for (const requirement of [
  ".data/cutovers/site-v3/",
  "docs/cutovers/site-v3-",
  "site-v3-cutover-manifest-v1",
  "manifest.environment !== report.environment",
  "report.environment !== currentEnvironment",
  "reportHash",
  "inventoryHash",
  "recoverySnapshot",
  "site-v3-database-snapshot-v1",
  ".metadata.json",
  "PGDMP",
  "verifyCurrentR2Inventory",
  'LODESTA_ARTIFACT_STORAGE !== "r2"',
  "assertCutoverQuiescent()",
  "assertExperimentalOnly(report)",
  "options.confirmation !== manifest.confirmation",
  "manifest.operator !== options.operator",
  "manifest.confirmationReason !== options.reason",
  "current.inventoryHash !== report.inventoryHash",
  "isConfirmedSandboxAbsent(error)",
  "destroyedSandboxIds",
  "absentSandboxIds",
  "site-v3-cutover-cleanup-receipt-v1",
  "cleanup-receipt.json",
  "writeCleanupReceipt(cleanupReceiptPath, cleanupReceipt)",
  '"id,site_id,hostname,status"',
  '"id,business_id,source_type,source_url,content_hash,captured_at"',
  '"id,session_id,site_id,status,run"',
  "cleanup_experimental_site_v1"
]) {
  assert(cutover.includes(requirement), `cutover operator is missing: ${requirement}`);
}
assert(cutover.indexOf("assertExperimentalOnly(report)") < cutover.indexOf("writeFile(reportPath"), "report must fail closed before durable output is accepted");
assert(cutover.indexOf("current.inventoryHash !== report.inventoryHash") < cutover.indexOf("const sandbox = configuredSiteSandboxClient"), "cleanup must revalidate the exact inventory before mutation");
assert(cutover.indexOf("await sandbox.destroy(sandboxId)") < cutover.indexOf('client.rpc("cleanup_experimental_site_v1"'), "sandbox disposal must precede row cleanup");
assert(cutover.indexOf('client.rpc("cleanup_experimental_site_v1"') < cutover.indexOf("configuredArtifactBlobMaintenanceStore({ write: true })"), "row cleanup must precede blob deletion");
for (const requirement of [
  "LODESTA_CUTOVER_DATABASE_URL",
  "site-v3-database-snapshot-v1",
  '"--format=custom"',
  '"--schema=public"',
  "PGHOST",
  "PGPASSWORD",
  "PGDATABASE",
  '!== "PGDMP"'
]) {
  assert(snapshot.includes(requirement), `database snapshot command is missing: ${requirement}`);
}
assert(!snapshot.includes("--dbname="), "database credential must not be exposed in the pg_dump process arguments");

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "session_not_found" }), { status: 404, headers: { "content-type": "application/json" } });
  const absentError = await new SiteSandboxClient("https://sandbox.example", "test-token").destroy("session-test")
    .then(() => undefined, (error) => error);
  assert(absentError instanceof SiteSandboxRequestError);
  assert.equal(absentError.action, "destroy");
  assert.equal(absentError.sessionId, "session-test");
  assert.equal(absentError.status, 404);
  assert.equal(absentError.providerCode, "session_not_found");
  assert(isConfirmedSandboxAbsent(absentError), "typed provider absence was not recognized");

  globalThis.fetch = async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json" } });
  const genericNotFound = await new SiteSandboxClient("https://sandbox.example", "test-token").destroy("session-test")
    .then(() => undefined, (error) => error);
  assert(genericNotFound instanceof SiteSandboxRequestError);
  assert(!isConfirmedSandboxAbsent(genericNotFound), "generic route not_found was incorrectly treated as confirmed sandbox absence");
} finally {
  globalThis.fetch = originalFetch;
}

console.log(JSON.stringify({
  ok: true,
  reportAndManifest: "pass",
  exactConfirmation: "pass",
  inventoryRevalidation: "pass",
  environmentBinding: "pass",
  recoverySnapshotBinding: "pass",
  databaseSnapshot: "pass",
  prelaunchReclassification: "pass",
  tracePayloadReconciliation: "pass",
  sandboxFailClosed: "pass",
  cleanupOrder: "pass",
  assertEmptyMigration: "pass",
  v3StoredFunctions: "pass"
}));
