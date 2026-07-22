import "./load-env";
import { execFile as execFileCallback } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { getSupabaseAdminClient } from "../lib/supabase/client";
import { sha256, stableJson } from "../packages/business-data";
import {
  buildWorkspaceBlobCutoverManifest,
  serializeWorkspaceSourceSidecar,
  workspaceSourceSidecarKey,
  workspaceSourceSidecarV1Schema
} from "../packages/site-artifacts";
import { configuredArtifactBlobMaintenanceStore } from "../packages/site-artifacts/maintenance-store";
import { siteWorkspaceRevisionV1Schema, type SiteWorkspaceRevisionV1 } from "../packages/site-contracts";
import { sitePlatformRepository } from "../packages/platform-data";

const execFile = promisify(execFileCallback);
const task = "workspace_storage_cutover";
const leasePath = resolve(process.cwd(), ".data/maintenance/workspace-storage-cutover-lease.json");
const manifestPath = resolve(process.cwd(), ".data/maintenance/workspace-blob-cutover.json");
const store = configuredArtifactBlobMaintenanceStore({ write: true });
const client = getSupabaseAdminClient();
const lease = await readLease();
await renewLease();
await assertDrained();

const revisions = await loadRevisions();
const copies: Array<{ key: string; bytes: number; contentHash: `sha256:${string}` }> = [];
for (const revision of revisions) {
  await renewLeaseIfNeeded();
  const backupId = revision.sourceArchiveKey.match(/^workspace-backups\/([a-f0-9]{64})\.tar\.gz$/)?.[1];
  if (!backupId) throw new Error(`Workspace revision ${revision.id} has a noncanonical archive key.`);
  const source = await store.get("artifact", revision.sourceArchiveKey);
  if (!source) throw new Error(`Retained workspace archive is missing from the artifact bucket: ${revision.sourceArchiveKey}.`);
  await store.putImmutable("workspace", {
    key: revision.sourceArchiveKey,
    bytes: source.bytes,
    contentType: "application/gzip",
    contentHash: source.contentHash
  });
  const destination = await store.get("workspace", revision.sourceArchiveKey);
  if (!destination || destination.contentHash !== source.contentHash || destination.bytes.length !== source.bytes.length) {
    throw new Error(`Workspace archive copy verification failed for ${revision.sourceArchiveKey}.`);
  }
  const extracted = await extractWorkspaceSource(source.bytes, backupId);
  const sidecar = workspaceSourceSidecarV1Schema.parse({
    schemaVersion: "workspace-source-sidecar-v1",
    backupId,
    archiveKey: revision.sourceArchiveKey,
    archiveHash: source.contentHash,
    sandboxRevision: extracted.sandboxRevision,
    sourceHash: revision.sourceHash,
    files: extracted.files.map((file) => ({
      ...file,
      contentHash: sha256(file.content),
      bytes: Buffer.byteLength(file.content)
    })),
    createdAt: revision.createdAt
  });
  const sidecarManifest = sidecar.files.map(({ path, contentHash, bytes }) => ({ path, contentHash, bytes }));
  if (stableJson(sidecarManifest) !== stableJson(revision.files)) {
    throw new Error(`Extracted source manifest does not match retained workspace revision ${revision.id}.`);
  }
  const sidecarBytes = serializeWorkspaceSourceSidecar(sidecar);
  const sidecarKey = workspaceSourceSidecarKey(revision.sourceArchiveKey);
  await store.putImmutable("artifact", {
    key: sidecarKey,
    bytes: sidecarBytes,
    contentType: "application/json; charset=utf-8",
    contentHash: sha256(sidecarBytes)
  });
  const verifiedSidecar = await store.get("artifact", sidecarKey);
  if (!verifiedSidecar) throw new Error(`Workspace source sidecar verification failed for ${sidecarKey}.`);
  workspaceSourceSidecarV1Schema.parse(JSON.parse(verifiedSidecar.bytes.toString("utf8")));
  copies.push({ key: revision.sourceArchiveKey, bytes: source.bytes.length, contentHash: source.contentHash });
}

await assertDrained();
const createdAt = new Date().toISOString();
const manifest = buildWorkspaceBlobCutoverManifest({
  schemaVersion: "workspace-blob-cutover-v1",
  createdAt,
  source: { store: "artifact", bucket: process.env.LODESTA_ARTIFACT_BUCKET ?? "lodesta-agentic-sites-v1" },
  destination: { store: "workspace", bucket: process.env.LODESTA_WORKSPACE_BUCKET ?? "lodesta-workspace-backups-v1" },
  rollbackNotBefore: new Date(Date.parse(createdAt) + 7 * 24 * 60 * 60_000).toISOString(),
  copies
});
await mkdir(dirname(manifestPath), { recursive: true });
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${JSON.stringify({ ok: true, revisions: revisions.length, copies: copies.length, manifestPath, manifestHash: manifest.manifestHash, leaseUntil: lease.leaseUntil })}\n`);

async function loadRevisions() {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from("site_workspace_revisions").select("*").order("created_at").range(from, from + 999);
    if (error) throw new Error(`Load retained workspace revisions: ${error.message}`);
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows.map(workspaceRevisionFromRow);
}

function workspaceRevisionFromRow(row: Record<string, unknown>): SiteWorkspaceRevisionV1 {
  return siteWorkspaceRevisionV1Schema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    siteId: row.site_id,
    parentRevisionId: row.parent_revision_id ?? undefined,
    revisionNumber: row.revision_number,
    sourceHash: row.source_hash,
    sourceArchiveKey: row.source_archive_key,
    files: row.files,
    createdAt: row.created_at,
    createdBy: { kind: row.created_by_kind, id: row.created_by_id }
  });
}

async function extractWorkspaceSource(archiveBytes: Buffer, backupId: string) {
  const directory = await mkdtemp(join(tmpdir(), "lodesta-workspace-migration-"));
  try {
    const archivePath = join(directory, `${backupId}.tar.gz`);
    await writeFile(archivePath, archiveBytes);
    const { stdout } = await execFile("tar", ["-tzf", archivePath], { maxBuffer: 4_000_000 });
    const entries = stdout.split("\n").filter(Boolean);
    for (const entry of entries) {
      const normalized = entry.replace(/^\.\//, "");
      if (normalized.startsWith("/") || normalized.split("/").includes("..")) throw new Error(`Workspace archive contains unsafe path ${entry}.`);
    }
    const sourceEntries = entries.filter((entry) => /^\.\/src\/(?!.*\.\.)(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.(?:css|json|ts|tsx)$/.test(entry)).sort();
    const revisionEntry = entries.find((entry) => entry === "./.lodesta/revision");
    if (!revisionEntry || !sourceEntries.length || sourceEntries.length > 80) throw new Error("Workspace archive is missing an allowlisted source set or sandbox revision.");
    await execFile("tar", ["-xzf", archivePath, "-C", directory, "--", revisionEntry, ...sourceEntries], { maxBuffer: 4_000_000 });
    const root = await realpath(directory);
    const files = [];
    for (const entry of sourceEntries) {
      const path = join(directory, entry.replace(/^\.\//, ""));
      const [resolved, details] = await Promise.all([realpath(path), lstat(path)]);
      if (!resolved.startsWith(`${root}/`) || !details.isFile() || details.isSymbolicLink()) throw new Error(`Extracted workspace path is unsafe: ${entry}.`);
      files.push({ path: entry.replace(/^\.\//, ""), content: await readFile(path, "utf8") });
    }
    const sandboxRevision = (await readFile(join(directory, ".lodesta/revision"), "utf8")).trim();
    if (!sandboxRevision || sandboxRevision.length > 200) throw new Error("Extracted sandbox revision is invalid.");
    return { files, sandboxRevision };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function assertDrained() {
  const [running, queued] = await Promise.all([
    sitePlatformRepository.listRecentAgentRuns({ status: "running", limit: 1 }),
    sitePlatformRepository.listRecentAgentRuns({ status: "queued", limit: 1 })
  ]);
  if (running.length || queued.length) throw new Error("Workspace migration lost quiescence; aborting before cutover.");
}

async function readLease() {
  const value = JSON.parse(await readFile(leasePath, "utf8")) as Record<string, unknown>;
  if (value.schemaVersion !== "workspace-cutover-lease-v1" || value.task !== task
    || typeof value.leaseTokenHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.leaseTokenHash)
    || typeof value.leaseUntil !== "string") throw new Error("Workspace cutover lease file is invalid.");
  return value as { schemaVersion: string; task: string; leaseTokenHash: string; leaseUntil: string };
}

async function renewLease() {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + 30 * 60_000).toISOString();
  if (!await sitePlatformRepository.renewMaintenanceLease(task, lease.leaseTokenHash, now.toISOString(), leaseUntil)) {
    throw new Error("Workspace cutover lease renewal failed; migration aborted.");
  }
  lease.leaseUntil = leaseUntil;
  await writeFile(leasePath, `${JSON.stringify(lease, null, 2)}\n`);
}

async function renewLeaseIfNeeded() {
  if (Date.parse(lease.leaseUntil) - Date.now() < 10 * 60_000) await renewLease();
}
