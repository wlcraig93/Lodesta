import "./load-env";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { getSupabaseAdminClient } from "../lib/supabase/client";

const options = parseArgs(process.argv.slice(2));
const repositoryRoot = process.cwd();
const client = getSupabaseAdminClient();
const exactConfirmation = `reclassify-prelaunch-draft:${options.runId}:${options.siteId}:${options.businessId}`;
if (options.confirmation !== exactConfirmation) throw new Error(`Pass --confirm=${exactConfirmation} to authorize this exact reclassification.`);

const reportPath = resolve(repositoryRoot, `.data/cutovers/site-v3/${options.runId}/report.json`);
const manifestPath = resolve(repositoryRoot, `docs/cutovers/site-v3-${options.runId}.json`);
if (await exists(reportPath) || await exists(manifestPath)) {
  throw new Error("Reclassification requires a run ID with no retained cutover report or manifest; regenerate them afterward.");
}
const databasePath = resolve(repositoryRoot, `.data/cutovers/site-v3/${options.runId}/database.dump`);
const databaseMetadataPath = `${databasePath}.metadata.json`;
const [databaseBytes, metadataBytes] = await Promise.all([readFile(databasePath), readFile(databaseMetadataPath)]);
const databaseHash = sha256(databaseBytes);
const metadata = JSON.parse(metadataBytes.toString("utf8")) as Record<string, unknown>;
const environment = environmentLabel();
if (databaseBytes.subarray(0, 5).toString("ascii") !== "PGDMP"
  || metadata.schemaVersion !== "site-v3-database-snapshot-v1"
  || metadata.runId !== options.runId
  || metadata.environment !== environment
  || metadata.hash !== databaseHash) {
  throw new Error("The original pre-reclassification database snapshot is missing, changed, or belongs to another environment.");
}

await assertQuiescent();
const footprint = await loadFootprint();
assertDisposableDraft(footprint);
const requestPath = resolve(repositoryRoot, `.data/cutovers/site-v3/${options.runId}/reclassification-request.json`);
await mkdir(dirname(requestPath), { recursive: true });
const request = {
  schemaVersion: "site-v3-prelaunch-reclassification-request-v1",
  runId: options.runId,
  environment,
  operator: options.operator,
  reason: options.reason,
  siteId: options.siteId,
  businessId: options.businessId,
  fromStatus: "draft",
  toStatus: "experimental",
  exactConfirmation,
  originalDatabaseSnapshot: {
    path: relative(repositoryRoot, databasePath),
    bytes: databaseBytes.length,
    hash: databaseHash,
    metadataHash: sha256(metadataBytes)
  },
  verifiedFootprint: footprint,
  requestedAt: new Date().toISOString()
};
await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`, { flag: "wx" });

await assertQuiescent();
const { data, error } = await client.rpc("reclassify_prelaunch_draft_site_for_v3_cutover_v1", {
  target_run_id: options.runId,
  target_site_id: options.siteId,
  target_business_id: options.businessId,
  confirmation_token: exactConfirmation
});
if (error) throw new Error(`Reclassify pre-launch site: ${error.message}`);
const result = data as Record<string, unknown> | null;
if (result?.ok !== true || result.siteId !== options.siteId || result.businessId !== options.businessId
  || result.fromStatus !== "draft" || result.toStatus !== "experimental") {
  throw new Error("Pre-launch site reclassification returned an invalid receipt.");
}
await assertQuiescent();
const updated = await loadFootprint();
if (updated.site?.status !== "experimental") throw new Error("Pre-launch site did not persist the experimental status.");
const receiptPath = resolve(repositoryRoot, `.data/cutovers/site-v3/${options.runId}/reclassification-receipt.json`);
const receipt = {
  ...request,
  schemaVersion: "site-v3-prelaunch-reclassification-receipt-v1",
  requestPath: relative(repositoryRoot, requestPath),
  requestHash: sha256(Buffer.from(`${JSON.stringify(request, null, 2)}\n`)),
  providerResult: result,
  verifiedStatus: updated.site.status,
  completedAt: new Date().toISOString()
};
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${JSON.stringify({ ok: true, runId: options.runId, siteId: options.siteId, fromStatus: "draft", toStatus: "experimental", requestPath: relative(repositoryRoot, requestPath), receiptPath: relative(repositoryRoot, receiptPath) }, null, 2)}\n`);

async function assertQuiescent() {
  const [{ data: active, error: leaseError }, { count, error: runsError }] = await Promise.all([
    client.rpc("site_agent_maintenance_active_v1", { task_name: "workspace_storage_cutover" }),
    client.from("site_agent_runs_v2").select("id", { count: "exact", head: true }).in("status", ["queued", "running"])
  ]);
  if (leaseError || active !== true) throw new Error(`Pre-launch reclassification requires the active maintenance lease: ${leaseError?.message ?? "inactive"}.`);
  if (runsError) throw new Error(`Check active site-agent runs: ${runsError.message}`);
  if ((count ?? 0) !== 0) throw new Error(`Pre-launch reclassification requires zero queued/running site-agent runs; found ${count}.`);
}

async function loadFootprint() {
  const [siteResult, domains, claims, inquiries, previews, publishedVersions] = await Promise.all([
    client.from("sites").select("id,business_id,status,workspace_id,published_version_id").eq("id", options.siteId).maybeSingle(),
    count("domains"),
    count("claims"),
    count("inquiries"),
    count("preview_tokens"),
    client.from("site_versions_v4").select("id", { count: "exact", head: true }).eq("site_id", options.siteId).eq("status", "published")
  ]);
  if (siteResult.error) throw new Error(`Load target site: ${siteResult.error.message}`);
  if (publishedVersions.error) throw new Error(`Count published versions: ${publishedVersions.error.message}`);
  return {
    site: siteResult.data as { id: string; business_id: string; status: string; workspace_id: string | null; published_version_id: string | null } | null,
    domains,
    claims,
    inquiries,
    previewTokens: previews,
    publishedVersions: publishedVersions.count ?? 0
  };
}

async function count(table: string) {
  const { count: value, error } = await client.from(table).select("*", { count: "exact", head: true }).eq("site_id", options.siteId);
  if (error) throw new Error(`Count ${table}: ${error.message}`);
  return value ?? 0;
}

function assertDisposableDraft(footprint: Awaited<ReturnType<typeof loadFootprint>>) {
  const site = footprint.site;
  if (!site || site.id !== options.siteId || site.business_id !== options.businessId || site.status !== "draft"
    || site.workspace_id !== null || site.published_version_id !== null
    || footprint.domains || footprint.claims || footprint.inquiries || footprint.previewTokens || footprint.publishedVersions) {
    throw new Error(`Target is not the exact disposable unpublished draft: ${JSON.stringify(footprint)}`);
  }
}

function parseArgs(args: string[]) {
  const value = (name: string) => args.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
  const runId = value("run-id");
  const siteId = value("site-id");
  const businessId = value("business-id");
  const operator = value("operator");
  const reason = value("reason");
  const confirmation = value("confirm");
  if (!runId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(runId)
    || !siteId?.startsWith("site_") || !businessId?.startsWith("business_")
    || !operator || !reason || !confirmation) {
    throw new Error("Use --run-id, --site-id, --business-id, --operator, --reason, and --confirm for the exact pre-launch draft.");
  }
  return { runId, siteId, businessId, operator, reason, confirmation };
}

function environmentLabel() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!raw) throw new Error("Pre-launch reclassification requires NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL.");
  return new URL(raw).hostname;
}

async function exists(path: string) { return stat(path).then(() => true, () => false); }
function sha256(value: Buffer) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
