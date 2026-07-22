import "./load-env";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { GET as servePublicSite } from "../app/sites/[slug]/[[...path]]/route";
import { getSupabaseAdminClient } from "../lib/supabase/client";
import { workspaceSourceSidecarKey } from "../packages/site-artifacts";
import { configuredArtifactBlobMaintenanceStore } from "../packages/site-artifacts/maintenance-store";
import { configuredSiteSandboxClient, isConfirmedSandboxAbsent } from "../packages/site-sandbox";

const options = parseArgs(process.argv.slice(2));
const expectedConfirmation = `delete-experimental:${options.siteId}:${options.businessId}`;
if (options.confirmation !== expectedConfirmation) {
  throw new Error(`Pass --confirm=${expectedConfirmation} to authorize this exact experimental cleanup.`);
}

const client = getSupabaseAdminClient();
const { data: site, error: siteError } = await client.from("sites").select("id,business_id,slug,status,published_version_id").eq("id", options.siteId).maybeSingle();
if (siteError) throw new Error(`Load experimental site: ${siteError.message}`);
if (!site || site.business_id !== options.businessId || site.status !== "experimental" || site.published_version_id) {
  throw new Error("Cleanup target is not the matching unpublished experimental site.");
}
const { data: sessions, error: sessionError } = await client.from("site_agent_sessions").select("sandbox_id").eq("site_id", options.siteId);
if (sessionError) throw new Error(`Load experimental sessions: ${sessionError.message}`);
const sandboxIds = (sessions ?? []).map((session) => session.sandbox_id).filter((value): value is string => typeof value === "string" && Boolean(value));
if (sandboxIds.length) {
  const sandbox = configuredSiteSandboxClient();
  for (const sandboxId of [...new Set(sandboxIds)].sort()) {
    try {
      await sandbox.destroy(sandboxId);
    } catch (error) {
      if (!isConfirmedSandboxAbsent(error)) throw error;
    }
  }
}

const { data, error } = await client.rpc("cleanup_experimental_site", {
  target_site_id: options.siteId,
  target_business_id: options.businessId,
  confirmation_token: options.confirmation
});
if (error) throw new Error(`Experimental cleanup RPC: ${error.message}`);
const result = data as { ok?: boolean; blobKeys?: unknown } | null;
if (!result?.ok) throw new Error("Experimental cleanup did not confirm success.");
const blobKeys = Array.isArray(result.blobKeys) ? result.blobKeys.filter((value): value is string => typeof value === "string") : [];
const blobs = configuredArtifactBlobMaintenanceStore({ write: true });
const deletedBlobs: string[] = [];
for (const key of blobKeys) {
  const store = key.startsWith("workspace-backups/") ? "workspace" : "artifact";
  if (await blobs.delete(store, key)) deletedBlobs.push(`${store}:${key}`);
  if (store === "workspace" && await blobs.delete("artifact", workspaceSourceSidecarKey(key))) {
    deletedBlobs.push(`artifact:${workspaceSourceSidecarKey(key)}`);
  }
}

for (const path of options.localPaths) {
  const target = resolve(process.cwd(), path);
  const dataRoot = resolve(process.cwd(), ".data");
  if (target !== dataRoot && !target.startsWith(`${dataRoot}/`)) throw new Error(`Local cleanup path escapes .data: ${path}`);
  await rm(target, { recursive: true, force: true });
}

const residual = await residualCounts(options.siteId, options.businessId);
if (Object.values(residual).some((count) => count !== 0)) throw new Error(`Experimental cleanup left residual rows: ${JSON.stringify(residual)}`);
const publicResponse = await servePublicSite(new Request(`http://127.0.0.1/sites/${site.slug}`), {
  params: Promise.resolve({ slug: site.slug, path: undefined })
});
if (publicResponse.status !== 404) throw new Error(`Deleted experimental site returned ${publicResponse.status} instead of 404.`);
process.stdout.write(`${JSON.stringify({ ok: true, siteId: options.siteId, businessId: options.businessId, deletedBlobs, localPaths: options.localPaths, residual, publicStatus: 404 }, null, 2)}\n`);

async function residualCounts(siteId: string, businessId: string) {
  const checks: Array<[string, string, string]> = [
    ["sites", "id", siteId],
    ["businesses", "id", businessId],
    ["site_versions_v4", "site_id", siteId],
    ["site_build_artifacts", "site_id", siteId],
    ["site_workspace_revisions", "site_id", siteId],
    ["site_public_build_inputs", "site_id", siteId],
    ["site_agent_sessions", "site_id", siteId],
    ["site_agent_runs", "site_id", siteId],
    ["site_operator_queue", "site_id", siteId],
    ["source_snapshots", "business_id", businessId],
    ["asset_revisions", "business_id", businessId]
  ];
  const entries = await Promise.all(checks.map(async ([table, column, value]) => {
    const { count, error } = await client.from(table).select("*", { count: "exact", head: true }).eq(column, value);
    if (error) throw new Error(`Verify ${table} cleanup: ${error.message}`);
    return [table, count ?? 0] as const;
  }));
  return Object.fromEntries(entries) as Record<string, number>;
}

function parseArgs(args: string[]) {
  const value = (name: string) => args.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  const siteId = value("site");
  const businessId = value("business");
  const confirmation = value("confirm");
  if (!siteId || !businessId || !confirmation) throw new Error("Usage: cleanup:experimental -- --site=<id> --business=<id> --confirm=<token> [--local-path=.data/path]");
  const localPaths = args.filter((item) => item.startsWith("--local-path=")).map((item) => item.slice("--local-path=".length)).filter(Boolean);
  return { siteId, businessId, confirmation, localPaths };
}
