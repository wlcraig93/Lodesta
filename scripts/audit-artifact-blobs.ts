import "./load-env";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getSupabaseAdminClient } from "../lib/supabase/client";
import {
  artifactBlobAuditConfirmation,
  assertArtifactBlobAuditDeletable,
  buildArtifactBlobAudit,
  parseArtifactBlobAuditReport,
  workspaceSourceSidecarKey,
  type ArtifactBlobAudit,
  type ArtifactBlobLocator
} from "../packages/site-artifacts";
import {
  artifactBlobStores,
  type LocatedBlobInventoryObject
} from "../packages/site-artifacts/blob-store";
import { configuredArtifactBlobMaintenanceStore } from "../packages/site-artifacts/maintenance-store";
import { siteBuildArtifactSchema } from "../packages/site-contracts";
import { sha256 } from "../packages/business-data";

const options = parseArgs(process.argv.slice(2));
const client = getSupabaseAdminClient();
const store = configuredArtifactBlobMaintenanceStore({ write: options.apply });

if (!options.apply) {
  const report = await createReport();
  await writeReport(options.reportPath, report);
  process.stdout.write(`${JSON.stringify({
    ok: report.missingReferencedObjects.length === 0,
    mode: "dry-run",
    reportPath: options.reportPath,
    confirmation: artifactBlobAuditConfirmation(report),
    report
  }, null, 2)}\n`);
  if (report.missingReferencedObjects.length) process.exitCode = 2;
} else {
  await assertPlatformQuiescent();
  const retainedReport = parseArtifactBlobAuditReport(JSON.parse(await readFile(options.reportPath, "utf8")));
  const expectedConfirmation = artifactBlobAuditConfirmation(retainedReport);
  if (options.confirmation !== expectedConfirmation) {
    throw new Error(`Pass --confirm=${expectedConfirmation} to authorize this exact orphan report.`);
  }
  assertArtifactBlobAuditDeletable(retainedReport);
  const freshReport = await createReport();
  assertArtifactBlobAuditDeletable(freshReport);
  if (freshReport.reportHash !== retainedReport.reportHash) {
    throw new Error(`Artifact inventory changed after review (${retainedReport.reportHash} -> ${freshReport.reportHash}); rerun the dry audit.`);
  }

  const deletedObjects: ArtifactBlobLocator[] = [];
  for (const batch of chunks(freshReport.orphanedManagedObjects, 25)) {
    const results = await Promise.all(batch.map(async (object) => ({ object, deleted: await store.delete(object.store, object.key) })));
    for (const result of results) {
      if (!result.deleted) throw new Error(`Reviewed orphan disappeared before deletion: ${result.object.store}:${result.object.key}.`);
      deletedObjects.push({ store: result.object.store, key: result.object.key });
    }
  }

  const postReport = await createReport();
  assertArtifactBlobAuditDeletable(postReport);
  if (postReport.orphanedManagedObjects.length) {
    throw new Error(`Artifact cleanup left ${postReport.orphanedManagedObjects.length} managed orphan(s).`);
  }
  const postReportPath = options.reportPath.replace(/\.json$/, "-post.json");
  await writeReport(postReportPath, postReport);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: "apply",
    reviewedReportPath: options.reportPath,
    reviewedReportHash: retainedReport.reportHash,
    deletedObjects,
    postReportPath,
    postReport
  }, null, 2)}\n`);
}

async function createReport() {
  const [inventory, references] = await Promise.all([listAllObjects(), collectReferencedObjects()]);
  const corruptReferencedIds = new Set<string>();
  for (const batch of chunks(references.exactObjects, 25)) {
    const checks = await Promise.all(batch.map(async (capture) => {
      try {
        const blob = await store.get(capture.store, capture.key);
        return Boolean(
          blob
          && blob.bytes.byteLength === capture.bytes
          && blob.contentHash === capture.contentHash
          && sha256(blob.bytes) === capture.contentHash
        );
      } catch {
        return false;
      }
    }));
    checks.forEach((valid, index) => {
      if (!valid) corruptReferencedIds.add(`${batch[index].store}:${batch[index].key}`);
    });
  }
  return buildArtifactBlobAudit({
    inventory: inventory.filter((object) => !corruptReferencedIds.has(`${object.store}:${object.key}`)),
    referencedObjects: references.objects
  });
}

async function listAllObjects() {
  const objects: LocatedBlobInventoryObject[] = [];
  for (const storeName of artifactBlobStores) {
    let cursor: string | undefined;
    const cursors = new Set<string>();
    do {
      const page = await store.listPage(storeName, { cursor, limit: 1000 });
      objects.push(...page.objects);
      if (!page.truncated) break;
      if (!page.cursor || cursors.has(page.cursor)) throw new Error(`${storeName} inventory returned a missing or repeated cursor.`);
      cursors.add(page.cursor);
      cursor = page.cursor;
    } while (true);
  }
  return objects;
}

async function collectReferencedObjects() {
  const objects = new Map<string, ArtifactBlobLocator>();
  const [assetRows, workspaceRows, runtimeRows, artifactRows, sourceCaptureRows, checkpointRows] = await Promise.all([
    selectAll("asset_revisions", "storage_path"),
    selectAll("site_workspace_revisions", "source_archive_key"),
    selectAll("trusted_runtime_patches", "storage_key"),
    selectAll("site_build_artifacts", "artifact"),
    selectAll("source_snapshot_resources", "storage_key,blob_content_hash,stored_bytes"),
    selectAll("site_agent_workspace_checkpoints", "backup_key,backup_hash,backup_bytes,sidecar_key,sidecar_hash,sidecar_bytes")
  ]);
  for (const row of assetRows) addObject(objects, "artifact", row.storage_path, "asset_revisions.storage_path");
  for (const row of workspaceRows) {
    const archiveKey = requiredKey(row.source_archive_key, "site_workspace_revisions.source_archive_key");
    addObject(objects, "workspace", archiveKey, "site_workspace_revisions.source_archive_key");
    addObject(objects, "artifact", workspaceSourceSidecarKey(archiveKey), "derived workspace source sidecar");
  }
  for (const row of runtimeRows) addObject(objects, "artifact", row.storage_key, "trusted_runtime_patches.storage_key");
  for (const row of artifactRows) {
    const artifact = siteBuildArtifactSchema.parse(row.artifact);
    for (const file of artifact.files) addObject(objects, "artifact", file.storageKey, "site_build_artifacts.artifact.files.storageKey");
    for (const screenshotKey of artifact.qa.screenshotKeys) addObject(objects, "artifact", screenshotKey, "site_build_artifacts.artifact.qa.screenshotKeys");
  }
  const exactObjects: Array<ArtifactBlobLocator & { contentHash: `sha256:${string}`; bytes: number }> = sourceCaptureRows.filter((row) => row.storage_key && row.blob_content_hash).map((row) => ({
    store: "artifact" as const,
    key: requiredKey(row.storage_key, "source_snapshot_resources.storage_key"),
    contentHash: requiredContentHash(row.blob_content_hash, "source_snapshot_resources.blob_content_hash"),
    bytes: requiredBytes(row.stored_bytes, "source_snapshot_resources.stored_bytes")
  }));
  for (const row of checkpointRows) {
    exactObjects.push({
      store: "workspace",
      key: requiredKey(row.backup_key, "site_agent_workspace_checkpoints.backup_key"),
      contentHash: requiredContentHash(row.backup_hash, "site_agent_workspace_checkpoints.backup_hash"),
      bytes: requiredBytes(row.backup_bytes, "site_agent_workspace_checkpoints.backup_bytes")
    }, {
      store: "artifact",
      key: requiredKey(row.sidecar_key, "site_agent_workspace_checkpoints.sidecar_key"),
      contentHash: requiredContentHash(row.sidecar_hash, "site_agent_workspace_checkpoints.sidecar_hash"),
      bytes: requiredBytes(row.sidecar_bytes, "site_agent_workspace_checkpoints.sidecar_bytes")
    });
  }
  for (const object of exactObjects) addObject(objects, object.store, object.key, "immutable retained object");
  return { objects: objects.values(), exactObjects };
}

async function selectAll(table: string, columns: string) {
  const rows: Array<Record<string, unknown>> = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client.from(table).select(columns).range(from, from + pageSize - 1);
    if (error) throw new Error(`Load ${table} blob references: ${error.message}`);
    const page = (data ?? []) as unknown as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function assertPlatformQuiescent() {
  const runs = await client.from("site_agent_runs").select("id", { count: "exact", head: true }).in("status", ["queued", "running", "needs_input"]);
  if (runs.error) throw new Error(`Check active site-agent runs: ${runs.error.message}`);
  if ((runs.count ?? 0) > 0) {
    throw new Error(`Artifact deletion requires a quiescent platform; ${runs.count ?? 0} site-agent run(s) remain active.`);
  }
}

function addObject(objects: Map<string, ArtifactBlobLocator>, storeName: ArtifactBlobLocator["store"], value: unknown, source: string) {
  const key = requiredKey(value, source);
  objects.set(`${storeName}:${key}`, { store: storeName, key });
}

function requiredKey(value: unknown, source: string) {
  if (typeof value !== "string" || !value) throw new Error(`${source} contains an invalid storage key.`);
  return value;
}

function requiredContentHash(value: unknown, source: string) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error(`${source} contains an invalid content hash.`);
  return value as `sha256:${string}`;
}

function requiredBytes(value: unknown, source: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${source} contains an invalid byte count.`);
  return value;
}

async function writeReport(path: string, report: ArtifactBlobAudit) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
}

function parseArgs(args: string[]) {
  let report = ".data/maintenance/artifact-blob-audit.json";
  let confirmation: string | undefined;
  let apply = false;
  for (const arg of args) {
    if (arg === "--apply") { apply = true; continue; }
    if (arg.startsWith("--report=")) { report = arg.slice("--report=".length); continue; }
    if (arg.startsWith("--confirm=")) { confirmation = arg.slice("--confirm=".length); continue; }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!apply && confirmation) throw new Error("--confirm is valid only with --apply.");
  const maintenanceRoot = resolve(process.cwd(), ".data", "maintenance");
  const reportPath = resolve(process.cwd(), report);
  if (!reportPath.startsWith(`${maintenanceRoot}/`) || !reportPath.endsWith(".json")) {
    throw new Error("Artifact maintenance reports must be JSON files under .data/maintenance.");
  }
  return { apply, confirmation, reportPath };
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}
