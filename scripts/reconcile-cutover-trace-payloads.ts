import "./load-env";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { getSupabaseAdminClient } from "../lib/supabase/client";
import { configuredArtifactBlobMaintenanceStore } from "../packages/site-artifacts/maintenance-store";

const options = parseArgs(process.argv.slice(2));
const repositoryRoot = process.cwd();
const client = getSupabaseAdminClient();
const confirmation = `reconcile-missing-trace-payloads:${options.cutoverRunId}:${options.agentRunId}:${options.expectedMissing}`;
if (options.confirmation !== confirmation) throw new Error(`Pass --confirm=${confirmation} to authorize this exact intermediate-reference reconciliation.`);
if (await exists(resolve(repositoryRoot, `.data/cutovers/site-v3/${options.cutoverRunId}/report.json`))
  || await exists(resolve(repositoryRoot, `docs/cutovers/site-v3-${options.cutoverRunId}.json`))) {
  throw new Error("Trace reconciliation must precede the fresh cutover report and manifest.");
}

const databasePath = resolve(repositoryRoot, `.data/cutovers/site-v3/${options.cutoverRunId}/database.dump`);
const metadataPath = `${databasePath}.metadata.json`;
const [databaseBytes, metadataBytes] = await Promise.all([readFile(databasePath), readFile(metadataPath)]);
const databaseHash = sha256(databaseBytes);
const metadata = JSON.parse(metadataBytes.toString("utf8")) as Record<string, unknown>;
if (databaseBytes.subarray(0, 5).toString("ascii") !== "PGDMP"
  || metadata.schemaVersion !== "site-v3-database-snapshot-v1"
  || metadata.runId !== options.cutoverRunId
  || metadata.environment !== environmentLabel()
  || metadata.hash !== databaseHash) {
  throw new Error("Trace reconciliation requires the unchanged original cutover database snapshot.");
}

await assertQuiescent();
const [{ data: run, error: runError }, { data: site, error: siteError }, { data: spans, error: spansError }] = await Promise.all([
  client.from("site_agent_runs_v2").select("id,site_id,status").eq("id", options.agentRunId).maybeSingle(),
  client.from("sites").select("id,status,published_version_id,workspace_id").eq("id", options.siteId).maybeSingle(),
  client.from("site_agent_trace_spans_v1").select("id,run_id,payload_ref,payload_hash,payload_expires_at")
    .eq("run_id", options.agentRunId).not("payload_ref", "is", null).order("id")
]);
if (runError || siteError || spansError) throw new Error(`Load trace reconciliation target: ${runError?.message ?? siteError?.message ?? spansError?.message}`);
if (!run || run.site_id !== options.siteId || !site || site.status !== "experimental"
  || site.published_version_id !== null || site.workspace_id !== null) {
  throw new Error("Trace reconciliation requires the exact unpublished, unclaimed experimental site and run.");
}
const candidates = (spans ?? []) as Array<{ id: string; run_id: string; payload_ref: string; payload_hash: string; payload_expires_at: string }>;
if (candidates.length !== options.expectedMissing
  || candidates.some((span) => span.run_id !== options.agentRunId
    || !span.payload_ref.startsWith(`trace-payloads/${options.agentRunId}/`)
    || !span.payload_hash?.startsWith("sha256:")
    || !span.payload_expires_at)) {
  throw new Error(`Trace reconciliation did not find the exact ${options.expectedMissing} target-run payload references.`);
}
const store = configuredArtifactBlobMaintenanceStore();
const dispositions = await Promise.all(candidates.map(async (span) => ({ ...span, exists: await store.exists("artifact", span.payload_ref) })));
if (dispositions.some((span) => span.exists)) throw new Error("Trace reconciliation found a payload object that still exists; no references were changed.");

const requestPath = resolve(repositoryRoot, `.data/cutovers/site-v3/${options.cutoverRunId}/trace-reconciliation-request.json`);
await mkdir(dirname(requestPath), { recursive: true });
const request = {
  schemaVersion: "site-v3-trace-reconciliation-request-v1",
  cutoverRunId: options.cutoverRunId,
  agentRunId: options.agentRunId,
  siteId: options.siteId,
  environment: environmentLabel(),
  operator: options.operator,
  reason: options.reason,
  confirmation,
  originalDatabaseSnapshot: { path: relative(repositoryRoot, databasePath), bytes: databaseBytes.length, hash: databaseHash, metadataHash: sha256(metadataBytes) },
  missingSpans: dispositions.map(({ exists: _exists, ...span }) => span),
  requestedAt: new Date().toISOString()
};
const requestBytes = Buffer.from(`${JSON.stringify(request, null, 2)}\n`);
await writeFile(requestPath, requestBytes, { flag: "wx" });

await assertQuiescent();
const ids = candidates.map((span) => span.id);
const { data: cleared, error: clearError } = await client.from("site_agent_trace_spans_v1")
  .update({ payload_ref: null, payload_hash: null, payload_expires_at: null })
  .eq("run_id", options.agentRunId).in("id", ids).not("payload_ref", "is", null).select("id");
if (clearError) throw new Error(`Clear missing trace payload references: ${clearError.message}`);
if ((cleared ?? []).length !== options.expectedMissing) throw new Error(`Trace reconciliation cleared ${(cleared ?? []).length} of ${options.expectedMissing} exact references.`);
await assertQuiescent();
const { count: remaining, error: remainingError } = await client.from("site_agent_trace_spans_v1")
  .select("*", { count: "exact", head: true }).eq("run_id", options.agentRunId).not("payload_ref", "is", null);
if (remainingError || (remaining ?? 0) !== 0) throw new Error(`Trace reconciliation left ${remaining ?? "unknown"} payload reference(s): ${remainingError?.message ?? ""}`);

const receiptPath = resolve(repositoryRoot, `.data/cutovers/site-v3/${options.cutoverRunId}/trace-reconciliation-receipt.json`);
await writeFile(receiptPath, `${JSON.stringify({
  ...request,
  schemaVersion: "site-v3-trace-reconciliation-receipt-v1",
  requestPath: relative(repositoryRoot, requestPath),
  requestHash: sha256(requestBytes),
  clearedSpanIds: ids,
  completedAt: new Date().toISOString()
}, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${JSON.stringify({ ok: true, cutoverRunId: options.cutoverRunId, agentRunId: options.agentRunId, cleared: ids.length, requestPath: relative(repositoryRoot, requestPath), receiptPath: relative(repositoryRoot, receiptPath) }, null, 2)}\n`);

async function assertQuiescent() {
  const [{ data: active, error: leaseError }, { count, error: runsError }] = await Promise.all([
    client.rpc("site_agent_maintenance_active_v1", { task_name: "workspace_storage_cutover" }),
    client.from("site_agent_runs_v2").select("*", { count: "exact", head: true }).in("status", ["queued", "running"])
  ]);
  if (leaseError || active !== true) throw new Error(`Trace reconciliation requires the active maintenance lease: ${leaseError?.message ?? "inactive"}.`);
  if (runsError || (count ?? 0) !== 0) throw new Error(`Trace reconciliation requires zero queued/running runs: ${runsError?.message ?? count}.`);
}

function parseArgs(args: string[]) {
  const value = (name: string) => args.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
  const cutoverRunId = value("cutover-run-id");
  const agentRunId = value("agent-run-id");
  const siteId = value("site-id");
  const expectedMissing = Number(value("expected-missing"));
  const operator = value("operator");
  const reason = value("reason");
  const confirmation = value("confirm");
  if (!cutoverRunId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(cutoverRunId)
    || !agentRunId?.startsWith("run_") || !siteId?.startsWith("site_")
    || !Number.isInteger(expectedMissing) || expectedMissing < 1 || expectedMissing > 500
    || !operator || !reason || !confirmation) {
    throw new Error("Use --cutover-run-id, --agent-run-id, --site-id, --expected-missing, --operator, --reason, and --confirm.");
  }
  return { cutoverRunId, agentRunId, siteId, expectedMissing, operator, reason, confirmation };
}

function environmentLabel() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!raw) throw new Error("Trace reconciliation requires NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL.");
  return new URL(raw).hostname;
}

async function exists(path: string) { return stat(path).then(() => true, () => false); }
function sha256(value: Buffer) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
