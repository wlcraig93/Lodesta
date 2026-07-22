import "./load-env";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { getSupabaseAdminClient } from "../lib/supabase/client";
import { parseArtifactBlobAuditReport, workspaceSourceSidecarKey } from "../packages/site-artifacts";
import { configuredArtifactBlobMaintenanceStore } from "../packages/site-artifacts/maintenance-store";
import { configuredSiteSandboxClient, isConfirmedSandboxAbsent, SiteSandboxRequestError } from "../packages/site-sandbox";

const options = parseArgs(process.argv.slice(2));
const client = getSupabaseAdminClient();
const repositoryRoot = process.cwd();
const maintenanceTask = "workspace_storage_cutover";

if (options.mode === "report") {
  if (!options.runId) throw new Error("Report mode requires --run-id=<stable run ID> so snapshots can be created first.");
  const runId = options.runId;
  if (!options.databaseBackup || !options.r2AuditReport) {
    throw new Error("Report mode requires --database-backup=<path> and --r2-audit-report=<path>.");
  }
  await assertCutoverQuiescent();
  const recoverySnapshot = await loadRecoverySnapshot(runId, options.databaseBackup, options.r2AuditReport);
  const report = { ...await collectInventory(runId), recoverySnapshot };
  assertExperimentalOnly(report);
  const reportPath = resolve(repositoryRoot, `.data/cutovers/site-v3/${runId}/report.json`);
  await mkdir(dirname(reportPath), { recursive: true });
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  await writeFile(reportPath, reportBytes, { flag: "wx" });
  const reportHash = sha256(reportBytes);
  const manifestPath = resolve(repositoryRoot, options.manifest ?? `docs/cutovers/site-v3-${runId}.json`);
  assertInside(manifestPath, resolve(repositoryRoot, "docs/cutovers"), "Manifest");
  await mkdir(dirname(manifestPath), { recursive: true });
  const manifest = {
    schemaVersion: "site-v3-cutover-manifest-v1",
    runId,
    environment: environmentLabel(),
    createdAt: report.createdAt,
    operator: options.operator,
    confirmationReason: options.reason,
    reportPath: relative(repositoryRoot, reportPath),
    reportHash,
    inventoryHash: report.inventoryHash,
    recoverySnapshot,
    affectedSites: report.sites.map((site) => ({ id: site.id, businessId: site.business_id, status: site.status })),
    counts: report.counts,
    confirmation: `delete-site-v3-cutover:${runId}:${reportHash}`
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({ ok: true, reportPath: relative(repositoryRoot, reportPath), manifestPath: relative(repositoryRoot, manifestPath), reportHash, inventoryHash: report.inventoryHash, confirmation: manifest.confirmation }, null, 2)}\n`);
} else {
  if (!options.manifest || !options.confirmation) throw new Error("Cleanup requires --manifest=<docs/cutovers/...json> and --confirm=<exact token>.");
  const manifestPath = resolve(repositoryRoot, options.manifest);
  assertInside(manifestPath, resolve(repositoryRoot, "docs/cutovers"), "Manifest");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as CutoverManifest;
  if (manifest.schemaVersion !== "site-v3-cutover-manifest-v1") throw new Error("Unsupported site V3 cutover manifest.");
  if (!isText(manifest.environment)) throw new Error("Cutover manifest is missing its environment binding.");
  if (options.confirmation !== manifest.confirmation) throw new Error(`Pass --confirm=${manifest.confirmation} to authorize this exact cutover.`);
  if (manifest.operator !== options.operator || manifest.confirmationReason !== options.reason) throw new Error("Operator and confirmation reason must exactly match the durable manifest.");
  const reportPath = resolve(repositoryRoot, manifest.reportPath);
  assertInside(reportPath, resolve(repositoryRoot, ".data/cutovers/site-v3"), "Report");
  const reportBytes = await readFile(reportPath);
  if (sha256(reportBytes) !== manifest.reportHash) throw new Error("Cutover report hash does not match the durable manifest.");
  const report = JSON.parse(reportBytes.toString("utf8")) as CutoverReport;
  if (manifest.runId !== report.runId) throw new Error("Cutover manifest run ID does not match the private report.");
  const currentEnvironment = environmentLabel();
  if (manifest.environment !== report.environment || report.environment !== currentEnvironment) {
    throw new Error(`Cutover environment mismatch: manifest=${manifest.environment}, report=${report.environment}, current=${currentEnvironment}.`);
  }
  if (JSON.stringify(manifest.recoverySnapshot) !== JSON.stringify(report.recoverySnapshot)) {
    throw new Error("Cutover manifest recovery snapshot does not match the private report.");
  }
  await verifyRecoverySnapshot(report.runId, report.recoverySnapshot);
  assertExperimentalOnly(report);
  await assertCutoverQuiescent();
  const current = await collectInventory(report.runId);
  assertExperimentalOnly(current);
  if (current.inventoryHash !== report.inventoryHash || current.inventoryHash !== manifest.inventoryHash) {
    throw new Error("Cutover inventory changed after the report. Generate and commit a new manifest before cleanup.");
  }
  await assertCutoverQuiescent();
  const sandboxIds = unique(report.sessions.map((session) => session.sandbox_id).filter(isText)).sort();
  const destroyedSandboxIds: string[] = [];
  const absentSandboxIds: string[] = [];
  const deletedSiteIds: string[] = [];
  const deletedBlobs: string[] = [];
  const cleanupReceiptPath = resolve(repositoryRoot, `.data/cutovers/site-v3/${report.runId}/cleanup-receipt.json`);
  const cleanupReceipt: CleanupReceipt = {
    schemaVersion: "site-v3-cutover-cleanup-receipt-v1",
    runId: report.runId,
    environment: currentEnvironment,
    reportHash: manifest.reportHash,
    status: "sandbox_cleanup",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    destroyedSandboxIds,
    absentSandboxIds,
    deletedSiteIds,
    deletedBlobs
  };
  await writeCleanupReceipt(cleanupReceiptPath, cleanupReceipt);
  if (sandboxIds.length) {
    const sandbox = configuredSiteSandboxClient();
    for (const sandboxId of sandboxIds) {
      try {
        await sandbox.destroy(sandboxId);
        destroyedSandboxIds.push(sandboxId);
      } catch (error) {
        if (isConfirmedSandboxAbsent(error)) {
          absentSandboxIds.push(sandboxId);
        } else {
          cleanupReceipt.status = "blocked";
          cleanupReceipt.failure = sandboxFailure(sandboxId, error);
          await writeCleanupReceipt(cleanupReceiptPath, cleanupReceipt);
          throw error;
        }
      }
      await writeCleanupReceipt(cleanupReceiptPath, cleanupReceipt);
    }
  }
  await assertCutoverQuiescent();
  cleanupReceipt.status = "row_cleanup";
  await writeCleanupReceipt(cleanupReceiptPath, cleanupReceipt);
  const blobKeys = new Set<string>(report.blobKeys);
  for (const site of report.sites) {
    const token = `delete-experimental:${site.id}:${site.business_id}`;
    const { data, error } = await client.rpc("cleanup_experimental_site_v1", {
      target_site_id: site.id,
      target_business_id: site.business_id,
      confirmation_token: token
    });
    if (error) throw new Error(`Cleanup ${site.id}: ${error.message}`);
    const result = data as { ok?: boolean; blobKeys?: unknown } | null;
    if (!result?.ok) throw new Error(`Cleanup ${site.id} did not confirm success.`);
    for (const key of Array.isArray(result.blobKeys) ? result.blobKeys : []) if (isText(key)) blobKeys.add(key);
    deletedSiteIds.push(String(site.id));
    await writeCleanupReceipt(cleanupReceiptPath, cleanupReceipt);
  }
  const residual = await collectInventory(report.runId);
  if (residual.sites.length || residual.counts.authorities !== 0) throw new Error(`Site V3 cutover left retained authorities: ${JSON.stringify(residual.counts)}`);
  await assertCutoverQuiescent();
  cleanupReceipt.status = "blob_cleanup";
  await writeCleanupReceipt(cleanupReceiptPath, cleanupReceipt);
  const blobs = configuredArtifactBlobMaintenanceStore({ write: true });
  for (const key of blobKeys) {
    const store = key.startsWith("workspace-backups/") ? "workspace" : "artifact";
    if (await blobs.delete(store, key)) deletedBlobs.push(`${store}:${key}`);
    if (store === "workspace" && await blobs.delete("artifact", workspaceSourceSidecarKey(key))) {
      deletedBlobs.push(`artifact:${workspaceSourceSidecarKey(key)}`);
    }
    await writeCleanupReceipt(cleanupReceiptPath, cleanupReceipt);
  }
  cleanupReceipt.status = "complete";
  cleanupReceipt.completedAt = new Date().toISOString();
  await writeCleanupReceipt(cleanupReceiptPath, cleanupReceipt);
  process.stdout.write(`${JSON.stringify({ ok: true, runId: report.runId, cleanupReceiptPath: relative(repositoryRoot, cleanupReceiptPath), deletedSites: deletedSiteIds, destroyedSandboxIds, absentSandboxIds, deletedBlobs, residual: residual.counts }, null, 2)}\n`);
}

type Row = Record<string, unknown>;
type CutoverInventory = Awaited<ReturnType<typeof collectInventory>>;
type RecoverySnapshot = Awaited<ReturnType<typeof loadRecoverySnapshot>>;
type CutoverReport = CutoverInventory & { recoverySnapshot: RecoverySnapshot };
type CutoverManifest = {
  schemaVersion: string;
  runId: string;
  environment: string;
  operator: string;
  confirmationReason: string;
  reportPath: string;
  reportHash: string;
  inventoryHash: string;
  recoverySnapshot: RecoverySnapshot;
  confirmation: string;
};
type CleanupReceipt = {
  schemaVersion: "site-v3-cutover-cleanup-receipt-v1";
  runId: string;
  environment: string;
  reportHash: string;
  status: "sandbox_cleanup" | "row_cleanup" | "blob_cleanup" | "blocked" | "complete";
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  destroyedSandboxIds: string[];
  absentSandboxIds: string[];
  deletedSiteIds: string[];
  deletedBlobs: string[];
  failure?: { sandboxId: string; errorName: string; httpStatus?: number; providerCode?: string };
};

async function loadRecoverySnapshot(runId: string, databaseBackupValue: string, r2AuditValue: string) {
  const databaseBackupPath = resolve(repositoryRoot, databaseBackupValue);
  const expectedDatabaseBackupPath = resolve(repositoryRoot, `.data/cutovers/site-v3/${runId}/database.dump`);
  if (databaseBackupPath !== expectedDatabaseBackupPath) {
    throw new Error(`Database backup must be ${relative(repositoryRoot, expectedDatabaseBackupPath)}.`);
  }
  const r2AuditPath = resolve(repositoryRoot, r2AuditValue);
  const expectedR2AuditPath = resolve(repositoryRoot, `.data/maintenance/site-v3-${runId}-artifact-audit.json`);
  if (r2AuditPath !== expectedR2AuditPath) {
    throw new Error(`R2 audit must be ${relative(repositoryRoot, expectedR2AuditPath)}.`);
  }
  const databaseMetadataPath = `${databaseBackupPath}.metadata.json`;
  const [databaseBytes, databaseMetadataBytes, auditBytes] = await Promise.all([readFile(databaseBackupPath), readFile(databaseMetadataPath), readFile(r2AuditPath)]);
  if (!databaseBytes.length || !databaseMetadataBytes.length || !auditBytes.length) throw new Error("Cutover recovery snapshot files must be non-empty.");
  if (databaseBytes.subarray(0, 5).toString("ascii") !== "PGDMP") throw new Error("Cutover database backup is not a PostgreSQL custom-format dump.");
  const databaseMetadata = JSON.parse(databaseMetadataBytes.toString("utf8")) as Record<string, unknown>;
  const databaseHash = sha256(databaseBytes);
  if (databaseMetadata.schemaVersion !== "site-v3-database-snapshot-v1"
    || databaseMetadata.runId !== runId
    || databaseMetadata.environment !== environmentLabel()
    || databaseMetadata.path !== relative(repositoryRoot, databaseBackupPath)
    || databaseMetadata.bytes !== databaseBytes.length
    || databaseMetadata.hash !== databaseHash) {
    throw new Error("Cutover database snapshot metadata does not match the dump or current environment.");
  }
  const audit = parseArtifactBlobAuditReport(JSON.parse(auditBytes.toString("utf8")));
  if (audit.missingReferencedObjects.length || audit.overlapMismatches.length) {
    throw new Error("R2 audit contains a missing retained object or rollback overlap mismatch.");
  }
  await verifyCurrentR2Inventory(audit.inventoryObjects);
  return {
    database: {
      path: relative(repositoryRoot, databaseBackupPath),
      metadataPath: relative(repositoryRoot, databaseMetadataPath),
      bytes: databaseBytes.length,
      hash: databaseHash,
      metadataHash: sha256(databaseMetadataBytes)
    },
    r2Audit: {
      path: relative(repositoryRoot, r2AuditPath),
      bytes: auditBytes.length,
      hash: sha256(auditBytes),
      reportHash: audit.reportHash,
      counts: audit.counts
    }
  };
}

async function verifyCurrentR2Inventory(expected: Array<{ store: "artifact" | "workspace"; key: string; bytes: number }>) {
  if (process.env.LODESTA_ARTIFACT_STORAGE !== "r2") throw new Error("Site V3 cutover recovery audit requires LODESTA_ARTIFACT_STORAGE=r2.");
  const store = configuredArtifactBlobMaintenanceStore();
  const current: Array<{ store: "artifact" | "workspace"; key: string; bytes: number }> = [];
  for (const storeName of ["artifact", "workspace"] as const) {
    let cursor: string | undefined;
    do {
      const page = await store.listPage(storeName, { cursor, limit: 1_000 });
      current.push(...page.objects.map((object) => ({ store: object.store, key: object.key, bytes: object.bytes })));
      if (!page.truncated) break;
      if (!page.cursor || page.cursor === cursor) throw new Error(`R2 ${storeName} inventory returned an invalid cursor.`);
      cursor = page.cursor;
    } while (true);
  }
  const canonical = (values: typeof current) => values.sort((left, right) => `${left.store}:${left.key}`.localeCompare(`${right.store}:${right.key}`));
  const expectedInventory = expected.map((object) => ({ store: object.store, key: object.key, bytes: object.bytes }));
  if (JSON.stringify(canonical(current)) !== JSON.stringify(canonical(expectedInventory))) {
    throw new Error("Current R2 object inventory does not match the retained pre-cutover audit.");
  }
}

async function verifyRecoverySnapshot(runId: string, expected: RecoverySnapshot) {
  if (!expected?.database?.path || !expected?.r2Audit?.path) throw new Error("Cutover report is missing its recovery snapshot binding.");
  const actual = await loadRecoverySnapshot(runId, expected.database.path, expected.r2Audit.path);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Cutover recovery snapshot files changed after report creation.");
}

async function writeCleanupReceipt(path: string, receipt: CleanupReceipt) {
  receipt.updatedAt = new Date().toISOString();
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`);
}

function sandboxFailure(sandboxId: string, error: unknown): NonNullable<CleanupReceipt["failure"]> {
  return {
    sandboxId,
    errorName: error instanceof Error ? error.name : "UnknownError",
    ...(error instanceof SiteSandboxRequestError ? { httpStatus: error.status, providerCode: error.providerCode } : {})
  };
}

async function assertCutoverQuiescent() {
  const [{ data: active, error: leaseError }, { count, error: runsError }] = await Promise.all([
    client.rpc("site_agent_maintenance_active_v1", { task_name: maintenanceTask }),
    client.from("site_agent_runs_v2").select("id", { count: "exact", head: true }).in("status", ["queued", "running"])
  ]);
  if (leaseError || active !== true) throw new Error(`Site V3 cutover requires the active ${maintenanceTask} lease: ${leaseError?.message ?? "inactive"}.`);
  if (runsError) throw new Error(`Check active site-agent runs: ${runsError.message}`);
  if ((count ?? 0) !== 0) throw new Error(`Site V3 cutover requires zero queued/running site-agent runs; found ${count}.`);
}

async function collectInventory(runId: string) {
  const sites = await rows("sites", "id,business_id,workspace_id,slug,status,published_version_id,current_workspace_revision_id,current_public_build_input_id,created_at,updated_at");
  const siteIds = sites.map((site) => String(site.id));
  const businessIds = sites.map((site) => String(site.business_id));
  const [states, intents, forms, versions, inputs, snapshots, artifacts, assets, assetRevisions, revisions, sessions, runs, domains, claims] = await Promise.all([
    related("business_states_v3", "site_id", siteIds, "business_id,site_id,schema_version,revision,state_hash,updated_at"),
    related("site_intents_v2", "site_id", siteIds, "id,site_id,schema_version,revision,intent_hash,created_at,updated_at"),
    related("form_definitions_v2", "site_id", siteIds, "id,site_id,schema_version,revision,status,created_at"),
    related("site_versions_v4", "site_id", siteIds, "id,site_id,status,artifact_id,workspace_revision_id,public_build_input_id,created_at,published_at"),
    related("site_public_build_inputs", "site_id", siteIds, "id,site_id,business_id,schema_version,input_hash,created_at"),
    related("source_snapshots", "business_id", businessIds, "id,business_id,schema_version,source_type,source_url,content_hash,captured_at"),
    related("site_build_artifacts", "site_id", siteIds, "id,site_id,workspace_revision_id,public_build_input_id,artifact_hash,storage_prefix,artifact,created_at"),
    related("business_assets", "business_id", businessIds, "id,business_id,kind,source,usage_scope,owner_approved,current_revision_id,active,created_at,updated_at"),
    related("asset_revisions", "business_id", businessIds, "id,asset_id,business_id,schema_version,content_hash,storage_path,rights_status,created_at"),
    related("site_workspace_revisions", "site_id", siteIds, "id,site_id,parent_revision_id,source_archive_key,source_hash,created_at"),
    related("site_agent_sessions", "site_id", siteIds, "id,site_id,owner_id,sandbox_id,status,public_build_input_id"),
    related("site_agent_runs_v2", "site_id", siteIds, "id,session_id,site_id,status,stage,run"),
    related("domains", "site_id", siteIds, "id,site_id,hostname,status"),
    related("claims", "site_id", siteIds, "id,site_id,status")
  ]);
  const runIds = runs.map((run) => String(run.id));
  const sessionIds = sessions.map((session) => String(session.id));
  const traces = uniqueRows([
    ...await related("site_agent_trace_spans_v1", "run_id", runIds, "id,run_id,session_id,request_id,status,payload_ref,payload_hash,payload_expires_at"),
    ...await related("site_agent_trace_spans_v1", "session_id", sessionIds, "id,run_id,session_id,request_id,status,payload_ref,payload_hash,payload_expires_at")
  ]);
  const blobKeys = unique([
    ...artifacts.flatMap((artifact) => artifactBlobKeys(artifact.artifact)),
    ...artifacts.flatMap((artifact) => screenshotKeys(artifact.artifact)),
    ...runs.flatMap((run) => screenshotKeys(run.run)),
    ...traces.map((trace) => trace.payload_ref).filter(isText),
    ...assetRevisions.map((asset) => asset.storage_path).filter(isText),
    ...revisions.map((revision) => revision.source_archive_key).filter(isText),
    ...revisions.map((revision) => revision.source_archive_key).filter(isText).map(workspaceSourceSidecarKey)
  ]).sort();
  const inventory = { sites, states, intents, forms, versions, inputs, snapshots, artifacts: artifacts.map(({ artifact: _document, ...artifact }) => artifact), assets, assetRevisions, revisions, sessions, runs: runs.map(({ run: _document, ...run }) => run), traces, domains, claims, blobKeys };
  const counts = {
    sites: sites.length,
    businessStates: states.length,
    intents: intents.length,
    forms: forms.length,
    versions: versions.length,
    inputs: inputs.length,
    snapshots: snapshots.length,
    artifacts: artifacts.length,
    assets: assets.length,
    assetRevisions: assetRevisions.length,
    workspaceRevisions: revisions.length,
    sessions: sessions.length,
    runs: runs.length,
    traces: traces.length,
    domains: domains.length,
    claims: claims.length,
    blobs: blobKeys.length,
    authorities: sites.length + states.length + intents.length + forms.length + versions.length + inputs.length + snapshots.length + artifacts.length + assets.length + assetRevisions.length + revisions.length
  };
  return {
    schemaVersion: "site-v3-cutover-report-v1" as const,
    runId,
    environment: environmentLabel(),
    createdAt: new Date().toISOString(),
    ...inventory,
    counts,
    inventoryHash: sha256(Buffer.from(JSON.stringify(inventory)))
  };
}

function assertExperimentalOnly(report: CutoverInventory) {
  const unsafe = report.sites.filter((site) => site.status !== "experimental" || site.published_version_id || site.workspace_id);
  if (unsafe.length) throw new Error(`Cutover aborted: customer, claimed, published, or non-experimental sites are present: ${JSON.stringify(unsafe.map((site) => ({ id: site.id, status: site.status, workspaceId: site.workspace_id, publishedVersionId: site.published_version_id })))}`);
  if (report.domains.length || report.claims.length || report.versions.some((version) => version.status === "published")) {
    throw new Error("Cutover aborted: a domain, claim, or published site version is present.");
  }
  const businessIds = report.sites.map((site) => String(site.business_id));
  if (new Set(businessIds).size !== businessIds.length) {
    throw new Error("Cutover aborted: more than one site shares a business authority; the per-site cleanup RPC cannot safely delete that graph.");
  }
}

async function rows(table: string, columns: string) {
  const { data, error } = await client.from(table).select(columns);
  if (error) throw new Error(`Inventory ${table}: ${error.message}`);
  return ((data ?? []) as unknown as Row[]).sort(compareRows);
}

async function related(table: string, column: string, ids: string[], columns: string) {
  if (!ids.length) return [] as Row[];
  const { data, error } = await client.from(table).select(columns).in(column, ids);
  if (error) throw new Error(`Inventory ${table}: ${error.message}`);
  return ((data ?? []) as unknown as Row[]).sort(compareRows);
}

function artifactBlobKeys(value: unknown) {
  const files = value && typeof value === "object" && Array.isArray((value as { files?: unknown }).files) ? (value as { files: unknown[] }).files : [];
  return files.flatMap((file) => file && typeof file === "object" && isText((file as { storageKey?: unknown }).storageKey) ? [(file as { storageKey: string }).storageKey] : []);
}

function screenshotKeys(value: unknown) {
  if (!value || typeof value !== "object") return [] as string[];
  const record = value as Record<string, unknown>;
  const direct = record.qa && typeof record.qa === "object" && Array.isArray((record.qa as Record<string, unknown>).screenshotKeys)
    ? (record.qa as Record<string, unknown>).screenshotKeys as unknown[]
    : [];
  const attempts = Array.isArray(record.attempts) ? record.attempts : [];
  return [...direct, ...attempts.flatMap((attempt) => attempt && typeof attempt === "object" && Array.isArray((attempt as Record<string, unknown>).screenshotKeys) ? (attempt as Record<string, unknown>).screenshotKeys as unknown[] : [])].filter(isText);
}

function parseArgs(args: string[]) {
  const value = (name: string) => args.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  const mode = value("mode");
  const operator = value("operator");
  const reason = value("reason");
  if (mode !== "report" && mode !== "cleanup") throw new Error("Use --mode=report or --mode=cleanup.");
  if (!operator || !reason) throw new Error("Use --operator=<id> and --reason=<confirmation reason>.");
  return {
    mode,
    operator,
    reason,
    runId: value("run-id"),
    manifest: value("manifest"),
    confirmation: value("confirm"),
    databaseBackup: value("database-backup"),
    r2AuditReport: value("r2-audit-report")
  };
}

function environmentLabel() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!raw) throw new Error("Site V3 cutover requires NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL.");
  try { return new URL(raw).hostname; } catch { throw new Error("Site V3 cutover Supabase URL is invalid."); }
}

function assertInside(target: string, root: string, label: string) {
  if (target === root || !target.startsWith(`${root}/`)) throw new Error(`${label} path must be a file inside ${relative(repositoryRoot, root)}.`);
}

function sha256(value: Buffer) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function isText(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function unique(values: string[]) { return [...new Set(values)]; }
function uniqueRows(values: Row[]) { return [...new Map(values.map((value) => [String(value.id), value])).values()].sort(compareRows); }
function compareRows(left: Row, right: Row) { return JSON.stringify(left).localeCompare(JSON.stringify(right)); }
