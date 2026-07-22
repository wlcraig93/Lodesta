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
import { siteBuildArtifactV1Schema } from "../packages/site-contracts";

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
  const [inventory, referencedObjects] = await Promise.all([listAllObjects(), collectReferencedObjects()]);
  return buildArtifactBlobAudit({ inventory, referencedObjects });
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
  const [assetRows, workspaceRows, runtimeRows, artifactRows] = await Promise.all([
    selectAll("asset_revisions", "storage_path"),
    selectAll("site_workspace_revisions", "source_archive_key"),
    selectAll("trusted_runtime_patches", "storage_key"),
    selectAll("site_build_artifacts", "artifact")
  ]);
  for (const row of assetRows) addObject(objects, "artifact", row.storage_path, "asset_revisions.storage_path");
  for (const row of workspaceRows) {
    const archiveKey = requiredKey(row.source_archive_key, "site_workspace_revisions.source_archive_key");
    addObject(objects, "workspace", archiveKey, "site_workspace_revisions.source_archive_key");
    addObject(objects, "artifact", workspaceSourceSidecarKey(archiveKey), "derived workspace source sidecar");
  }
  for (const row of runtimeRows) addObject(objects, "artifact", row.storage_key, "trusted_runtime_patches.storage_key");
  for (const row of artifactRows) {
    const artifact = siteBuildArtifactV1Schema.parse(row.artifact);
    for (const file of artifact.files) addObject(objects, "artifact", file.storageKey, "site_build_artifacts.artifact.files.storageKey");
    for (const screenshotKey of artifact.qa.screenshotKeys) addObject(objects, "artifact", screenshotKey, "site_build_artifacts.artifact.qa.screenshotKeys");
  }
  return objects.values();
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
  const { count, error } = await client.from("site_agent_runs").select("id", { count: "exact", head: true }).in("status", ["queued", "running"]);
  if (error) throw new Error(`Check active site-agent runs: ${error.message}`);
  if ((count ?? 0) > 0) throw new Error(`Artifact deletion requires a quiescent platform; ${count} site-agent run(s) are queued or running.`);
}

function addObject(objects: Map<string, ArtifactBlobLocator>, storeName: ArtifactBlobLocator["store"], value: unknown, source: string) {
  const key = requiredKey(value, source);
  objects.set(`${storeName}:${key}`, { store: storeName, key });
}

function requiredKey(value: unknown, source: string) {
  if (typeof value !== "string" || !value) throw new Error(`${source} contains an invalid storage key.`);
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
