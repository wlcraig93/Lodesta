import "./load-env";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { getSupabaseAdminClient } from "../lib/supabase/client";
import { sha256, stableJson } from "../packages/business-data";
import { workspaceBlobCutoverManifestV1Schema, workspaceSourceSidecarKey } from "../packages/site-artifacts";
import { configuredArtifactBlobMaintenanceStore } from "../packages/site-artifacts/maintenance-store";

const options = parseArgs(process.argv.slice(2));
const repositoryRoot = process.cwd();
const client = getSupabaseAdminClient();
const manifestPath = resolve(repositoryRoot, ".data/maintenance/workspace-blob-cutover.json");
const markerPath = resolve(repositoryRoot, ".data/maintenance/workspace-blob-cutover-cleaned.json");
const cutoverDirectory = resolve(repositoryRoot, `.data/cutovers/site-v3/${options.cutoverRunId}`);
const cleanupReceiptPath = resolve(cutoverDirectory, "cleanup-receipt.json");
const requestPath = resolve(cutoverDirectory, "workspace-rollback-retirement-request.json");
const receiptPath = resolve(cutoverDirectory, "workspace-rollback-retirement-receipt.json");
const manifestBytes = await readFile(manifestPath);
const manifest = workspaceBlobCutoverManifestV1Schema.parse(JSON.parse(manifestBytes.toString("utf8")));
const confirmation = `retire-workspace-rollback-after-site-v3:${options.cutoverRunId}:${manifest.manifestHash}`;

if (options.manifestHash !== manifest.manifestHash) throw new Error("Reviewed workspace cutover manifest hash does not match the retained manifest.");
if (options.confirmation !== confirmation) throw new Error(`Pass --confirm=${confirmation} to retire only this exact rollback expectation.`);
if (await exists(markerPath)) throw new Error("A workspace rollback cleanup or retirement marker already exists.");
if (await exists(requestPath) || await exists(receiptPath)) throw new Error("A request or receipt already exists for this Site V3 cutover run.");

const cleanupReceipt = JSON.parse(await readFile(cleanupReceiptPath, "utf8")) as Record<string, unknown>;
if (cleanupReceipt.schemaVersion !== "site-v3-cutover-cleanup-receipt-v1"
  || cleanupReceipt.runId !== options.cutoverRunId
  || cleanupReceipt.environment !== environmentLabel()
  || cleanupReceipt.status !== "complete"
  || !Array.isArray(cleanupReceipt.deletedSiteIds)
  || cleanupReceipt.deletedSiteIds.length < 1
  || !Array.isArray(cleanupReceipt.deletedBlobs)) {
  throw new Error("Workspace rollback retirement requires the completed, environment-matched Site V3 cleanup receipt.");
}
const deletedBlobs = new Set(cleanupReceipt.deletedBlobs.filter((value): value is string => typeof value === "string"));
for (const copy of manifest.copies) {
  if (!deletedBlobs.has(`workspace:${copy.key}`)
    || !deletedBlobs.has(`artifact:${workspaceSourceSidecarKey(copy.key)}`)) {
    throw new Error(`Site V3 cleanup receipt did not enumerate the workspace destination and sidecar for ${copy.key}.`);
  }
}

await assertQuiescentAndEmpty();
const store = configuredArtifactBlobMaintenanceStore();
const dispositions = await inspectCopies();

const request = {
  schemaVersion: "site-v3-workspace-rollback-retirement-request-v1",
  cutoverRunId: options.cutoverRunId,
  environment: environmentLabel(),
  operator: options.operator,
  reason: options.reason,
  confirmation,
  workspaceManifest: {
    path: relative(repositoryRoot, manifestPath),
    hash: sha256(manifestBytes),
    manifestHash: manifest.manifestHash,
    rollbackNotBefore: manifest.rollbackNotBefore
  },
  siteV3CleanupReceipt: {
    path: relative(repositoryRoot, cleanupReceiptPath),
    hash: sha256(await readFile(cleanupReceiptPath))
  },
  dispositions,
  requestedAt: new Date().toISOString()
};
const requestBytes = Buffer.from(`${JSON.stringify(request, null, 2)}\n`);
await mkdir(dirname(requestPath), { recursive: true });
await writeFile(requestPath, requestBytes, { flag: "wx" });

await assertQuiescentAndEmpty();
const finalDispositions = await inspectCopies();
if (stableJson(finalDispositions) !== stableJson(dispositions)) throw new Error("Workspace rollback object disposition changed after review.");

const markerPayload = {
  schemaVersion: "workspace-blob-cutover-cleanup-v1",
  manifestHash: manifest.manifestHash,
  completedAt: new Date().toISOString(),
  deleted: [],
  disposition: "retained_recovery_sources_after_authority_cutover",
  siteV3CutoverRunId: options.cutoverRunId,
  retained: finalDispositions.map((entry) => ({ store: "artifact" as const, key: entry.key, bytes: entry.bytes, contentHash: entry.contentHash }))
};
const marker = { ...markerPayload, reportHash: sha256(stableJson(markerPayload)) };
const markerBytes = Buffer.from(`${JSON.stringify(marker, null, 2)}\n`);
await writeFile(markerPath, markerBytes, { flag: "wx" });

const receipt = {
  ...request,
  schemaVersion: "site-v3-workspace-rollback-retirement-receipt-v1",
  requestPath: relative(repositoryRoot, requestPath),
  requestHash: sha256(requestBytes),
  markerPath: relative(repositoryRoot, markerPath),
  markerHash: sha256(markerBytes),
  completedAt: new Date().toISOString()
};
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${JSON.stringify({
  ok: true,
  cutoverRunId: options.cutoverRunId,
  retainedRecoverySources: finalDispositions.length,
  markerPath: relative(repositoryRoot, markerPath),
  receiptPath: relative(repositoryRoot, receiptPath)
}, null, 2)}\n`);

async function inspectCopies() {
  return Promise.all(manifest.copies.map(async (copy) => {
    const [source, destination, sidecar] = await Promise.all([
      store.get("artifact", copy.key),
      store.get("workspace", copy.key),
      store.get("artifact", workspaceSourceSidecarKey(copy.key))
    ]);
    if (!source || destination || sidecar) {
      throw new Error(`Expected one retained source and no destination/sidecar for ${copy.key}.`);
    }
    if (source.bytes.length !== copy.bytes || source.contentHash !== copy.contentHash) {
      throw new Error(`Retained recovery source differs from the reviewed workspace manifest: artifact:${copy.key}.`);
    }
    return { key: copy.key, bytes: copy.bytes, contentHash: copy.contentHash, sourceRetained: true, destinationDeleted: true, sidecarDeleted: true };
  }));
}

async function assertQuiescentAndEmpty() {
  const [{ data: active, error: leaseError }, { count: runs, error: runsError }] = await Promise.all([
    client.rpc("site_agent_maintenance_active_v1", { task_name: "workspace_storage_cutover" }),
    client.from("site_agent_runs_v2").select("*", { count: "exact", head: true }).in("status", ["queued", "running"])
  ]);
  if (leaseError || active !== true) throw new Error(`Workspace rollback retirement requires the active maintenance lease: ${leaseError?.message ?? "inactive"}.`);
  if (runsError || (runs ?? 0) !== 0) throw new Error(`Workspace rollback retirement requires zero queued/running runs: ${runsError?.message ?? runs}.`);

  for (const table of ["sites", "business_states_v3", "site_intents_v3", "site_public_build_inputs", "site_workspace_revisions", "site_build_artifacts", "site_versions_v4"]) {
    const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
    if (error || (count ?? 0) !== 0) throw new Error(`Workspace rollback retirement requires empty ${table}: ${error?.message ?? count}.`);
  }
}

function parseArgs(args: string[]) {
  const value = (name: string) => args.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
  const cutoverRunId = value("cutover-run-id");
  const manifestHash = value("manifest-hash");
  const operator = value("operator");
  const reason = value("reason");
  const confirmation = value("confirm");
  if (!cutoverRunId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(cutoverRunId)
    || !manifestHash || !/^sha256:[a-f0-9]{64}$/.test(manifestHash)
    || !operator || !reason || !confirmation) {
    throw new Error("Use --cutover-run-id, --manifest-hash, --operator, --reason, and --confirm.");
  }
  return { cutoverRunId, manifestHash, operator, reason, confirmation };
}

function environmentLabel() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!raw) throw new Error("Workspace rollback retirement requires NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL.");
  return new URL(raw).hostname;
}

async function exists(path: string) { return stat(path).then(() => true, () => false); }
