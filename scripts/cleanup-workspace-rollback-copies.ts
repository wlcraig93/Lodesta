import "./load-env";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getSupabaseAdminClient } from "../lib/supabase/client";
import { sha256, stableJson } from "../packages/business-data";
import { workspaceBlobCutoverManifestV1Schema, workspaceSourceSidecarKey } from "../packages/site-artifacts";
import { configuredArtifactBlobMaintenanceStore } from "../packages/site-artifacts/maintenance-store";

const manifestPath = resolve(process.cwd(), ".data/maintenance/workspace-blob-cutover.json");
const markerPath = resolve(process.cwd(), ".data/maintenance/workspace-blob-cutover-cleaned.json");
const manifest = workspaceBlobCutoverManifestV1Schema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
const expected = `delete-old-workspace-blobs:${manifest.manifestHash}`;
const confirmation = process.argv.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length);
if (confirmation !== expected) throw new Error(`Pass --confirm=${expected} to delete only this manifest's old artifact-bucket rollback copies.`);
if (Date.now() < Date.parse(manifest.rollbackNotBefore)) throw new Error(`Rollback copies are retained until ${manifest.rollbackNotBefore}.`);

const client = getSupabaseAdminClient();
const store = configuredArtifactBlobMaintenanceStore({ write: true });
const retained = await retainedWorkspaceKeys();
const deleted: string[] = [];
for (const copy of manifest.copies) {
  if (!retained.has(copy.key)) throw new Error(`Cutover manifest key is no longer retained by the database: ${copy.key}.`);
  const [source, destination, sidecar] = await Promise.all([
    store.get("artifact", copy.key),
    store.get("workspace", copy.key),
    store.get("artifact", workspaceSourceSidecarKey(copy.key))
  ]);
  if (!source || !destination || !sidecar) throw new Error(`Rollback cleanup prerequisites are missing for ${copy.key}.`);
  for (const object of [source, destination]) {
    if (object.contentHash !== copy.contentHash || object.bytes.length !== copy.bytes) {
      throw new Error(`Rollback copy differs from its reviewed manifest: ${object.store}:${copy.key}.`);
    }
  }
}

for (const copy of manifest.copies) {
  if (!await store.delete("artifact", copy.key)) throw new Error(`Reviewed rollback source disappeared before deletion: artifact:${copy.key}.`);
  deleted.push(copy.key);
}

for (const copy of manifest.copies) {
  const [oldExists, destinationExists, sidecarExists] = await Promise.all([
    store.exists("artifact", copy.key),
    store.exists("workspace", copy.key),
    store.exists("artifact", workspaceSourceSidecarKey(copy.key))
  ]);
  if (oldExists || !destinationExists || !sidecarExists) throw new Error(`Post-cleanup verification failed for ${copy.key}.`);
}

const payload = {
  schemaVersion: "workspace-blob-cutover-cleanup-v1",
  manifestHash: manifest.manifestHash,
  completedAt: new Date().toISOString(),
  deleted
};
const report = { ...payload, reportHash: sha256(stableJson(payload)) };
await mkdir(dirname(markerPath), { recursive: true });
await writeFile(markerPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${JSON.stringify({ ok: true, manifestHash: manifest.manifestHash, deleted: deleted.length, markerPath, reportHash: report.reportHash })}\n`);

async function retainedWorkspaceKeys() {
  const keys = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from("site_workspace_revisions").select("source_archive_key").range(from, from + 999);
    if (error) throw new Error(`Load retained workspace archive keys: ${error.message}`);
    const rows = (data ?? []) as Array<{ source_archive_key?: unknown }>;
    for (const row of rows) {
      if (typeof row.source_archive_key !== "string") throw new Error("Retained workspace revision has an invalid archive key.");
      keys.add(row.source_archive_key);
    }
    if (rows.length < 1000) return keys;
  }
}
