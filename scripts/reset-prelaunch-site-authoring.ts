import "./load-env";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "../lib/supabase/client";
import { sha256, stableJson } from "../packages/business-data";
import { configuredSiteSandboxClient, isConfirmedSandboxAbsent } from "../packages/site-sandbox";

const reportPath = resolve(process.cwd(), ".data/maintenance/site-authoring-reset.json");
const options = parseArgs(process.argv.slice(2));
const client = getSupabaseAdminClient();

if (!options.apply) {
  const report = await createReport(client);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: "report",
    reportPath,
    confirmation: confirmationFor(report),
    report
  }, null, 2)}\n`);
} else {
  const reviewed = parseReport(JSON.parse(await readFile(reportPath, "utf8")));
  const expectedConfirmation = confirmationFor(reviewed);
  if (options.confirmation !== expectedConfirmation) {
    throw new Error(`Pass --confirm=${expectedConfirmation} to authorize this exact prelaunch generated-site reset.`);
  }
  await assertMaintenanceLease(client);
  const fresh = await createReport(client);
  if (fresh.reportHash !== reviewed.reportHash) {
    throw new Error(`Generated-site inventory changed after review (${reviewed.reportHash} -> ${fresh.reportHash}); rerun the report.`);
  }
  if (fresh.activeRuns.length) {
    throw new Error(`Generated-site reset requires a drained platform; ${fresh.activeRuns.length} run(s) remain queued or running.`);
  }
  await destroySandboxes(fresh.sessions);
  await resetGeneratedSiteRows(client);
  const post = await createReport(client);
  if (post.counts.sites || post.counts.versions || post.counts.sessions || post.counts.runs || post.counts.setups) {
    throw new Error(`Generated-site reset was incomplete: ${JSON.stringify(post.counts)}.`);
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: "apply",
    reviewedReportHash: reviewed.reportHash,
    resetCounts: reviewed.counts,
    orphanCleanupNext: "npm run audit:artifact-blobs, then apply its exact delete-orphan-blobs confirmation",
    postCounts: post.counts
  }, null, 2)}\n`);
}

type ResetReport = {
  schemaVersion: 1;
  kind: "prelaunch-site-authoring-reset";
  createdAt: string;
  reportHash: `sha256:${string}`;
  counts: Record<string, number>;
  sites: Array<Record<string, unknown>>;
  versions: Array<Record<string, unknown>>;
  artifacts: Array<Record<string, unknown>>;
  workspaces: Array<Record<string, unknown>>;
  assets: Array<Record<string, unknown>>;
  snapshots: Array<Record<string, unknown>>;
  sessions: Array<Record<string, unknown>>;
  runs: Array<Record<string, unknown>>;
  activeRuns: Array<Record<string, unknown>>;
  setups: Array<Record<string, unknown>>;
};

async function createReport(database: SupabaseClient): Promise<ResetReport> {
  const [sites, versions, artifacts, workspaces, assets, snapshots, sessions, runs, setups] = await Promise.all([
    selectAll(database, "sites", "id,slug,business_id,owner_user_id,status,published_version_id,current_workspace_revision_id,current_public_build_input_id"),
    selectAll(database, "site_versions", "id,site_id,status,schema_version,artifact_id,workspace_revision_id,public_build_input_id"),
    selectAll(database, "site_build_artifacts", "id,site_id,toolchain_version,sandbox_image_digest,storage_prefix"),
    selectAll(database, "site_workspace_revisions", "id,site_id,source_archive_key,source_hash"),
    selectFirstAvailable(database, "asset_revisions", [
      "id,asset_id,business_id,storage_path,origin",
      "id,asset_id,business_id,storage_path,rights_status"
    ]),
    selectAll(database, "source_snapshots", "id,business_id,source_type,content_hash"),
    selectAll(database, "site_agent_sessions", "id,site_id,status,sandbox_id"),
    selectAll(database, "site_agent_runs", "id,site_id,session_id,status,kind"),
    selectAll(database, "website_setups", "id,owner_user_id,status,site_id,session_id,run_id")
  ]);
  const canonical = {
    schemaVersion: 1 as const,
    kind: "prelaunch-site-authoring-reset" as const,
    counts: {
      sites: sites.length,
      versions: versions.length,
      artifacts: artifacts.length,
      workspaces: workspaces.length,
      assets: assets.length,
      snapshots: snapshots.length,
      sessions: sessions.length,
      runs: runs.length,
      setups: setups.length
    },
    sites: sortRows(sites),
    versions: sortRows(versions),
    artifacts: sortRows(artifacts),
    workspaces: sortRows(workspaces),
    assets: sortRows(assets),
    snapshots: sortRows(snapshots),
    sessions: sortRows(sessions),
    runs: sortRows(runs),
    activeRuns: sortRows(runs.filter((row) => row.status === "queued" || row.status === "running")),
    setups: sortRows(setups)
  };
  return {
    ...canonical,
    createdAt: new Date().toISOString(),
    reportHash: sha256(stableJson(canonical))
  };
}

function parseReport(value: unknown): ResetReport {
  if (!value || typeof value !== "object") throw new Error("The prelaunch reset report is invalid.");
  const report = value as ResetReport;
  const { createdAt: _createdAt, reportHash, ...canonical } = report;
  if (
    report.schemaVersion !== 1
    || report.kind !== "prelaunch-site-authoring-reset"
    || typeof report.createdAt !== "string"
    || !Number.isFinite(Date.parse(report.createdAt))
    || reportHash !== sha256(stableJson(canonical))
  ) {
    throw new Error("The prelaunch reset report failed integrity verification.");
  }
  return report;
}

function confirmationFor(report: Pick<ResetReport, "reportHash">) {
  return `reset-prelaunch:${report.reportHash}`;
}

async function assertMaintenanceLease(database: SupabaseClient) {
  const { data, error } = await database.from("site_agent_maintenance_leases")
    .select("lease_until")
    .eq("task", "site_authoring_maintenance")
    .maybeSingle();
  if (error) throw new Error(`Check site-authoring maintenance lease: ${error.message}`);
  const leaseUntil = typeof data?.lease_until === "string" ? Date.parse(data.lease_until) : Number.NaN;
  if (!Number.isFinite(leaseUntil) || leaseUntil <= Date.now()) {
    throw new Error("Acquire the site-authoring maintenance lease before applying the prelaunch reset.");
  }
}

async function destroySandboxes(sessions: Array<Record<string, unknown>>) {
  const retained = sessions.filter((session) => typeof session.sandbox_id === "string" && session.sandbox_id.length > 0);
  if (!retained.length) return;
  const sandbox = configuredSiteSandboxClient();
  for (const session of retained) {
    if (typeof session.id !== "string") throw new Error("Cutover report contains an invalid sandbox session ID.");
    try {
      await sandbox.destroy(session.id);
    } catch (error) {
      if (!isConfirmedSandboxAbsent(error)) throw error;
    }
  }
}

async function resetGeneratedSiteRows(database: SupabaseClient) {
  await updateAll(database, "outbound_events", { site_id: null }, "id");
  await updateAll(database, "outbound_prospects", { site_id: null }, "id");
  await updateAll(database, "sites", {
    published_version_id: null,
    current_workspace_revision_id: null,
    current_public_build_input_id: null
  }, "id");
  await updateAll(database, "site_versions", { replaced_version_id: null }, "id");
  await updateAll(database, "site_workspace_revisions", { parent_revision_id: null }, "id");

  for (const [table, filterColumn] of [
    ["website_setups", "id"],
    ["external_authoring_operations", "id"],
    ["external_authoring_claims", "id"],
    ["external_authoring_executions", "id"],
    ["authoring_execution_bundles", "id"],
    ["external_authoring_batch_items", "id"],
    ["external_authoring_batches", "id"],
    ["authoring_outbox", "id"],
    ["staged_blob_receipts", "id"],
    ["preview_grants", "id"],
    ["active_domains", "hostname"],
    ["domains", "id"],
    ["adoption_invitations", "id"],
    ["site_redirects", "id"],
    ["inquiry_events", "id"],
    ["inquiries", "id"],
    ["analytics_events", "id"],
    ["control_plane_change_requests", "id"],
    ["site_operator_queue", "id"],
    ["site_agent_run_events", "id"],
    ["site_agent_messages", "id"],
    ["site_agent_runs", "id"],
    ["site_agent_sessions", "id"],
    ["site_version_sources", "version_id"],
    ["site_version_assets", "version_id"],
    ["site_version_forms", "version_id"],
    ["site_versions", "id"],
    ["site_build_artifacts", "id"],
    ["site_workspace_revisions", "id"],
    ["site_public_build_input_sources", "input_id"],
    ["site_public_build_input_assets", "input_id"],
    ["site_public_build_input_forms", "input_id"],
    ["site_public_build_inputs", "id"],
    ["form_definitions", "id"],
    ["business_states", "business_id"],
    ["site_intents", "id"],
    ["asset_revisions", "id"],
    ["source_snapshots", "id"],
    ["sites", "id"],
    ["businesses", "id"]
  ] as const) {
    await deleteAll(database, table, filterColumn);
  }
}

async function selectAll(database: SupabaseClient, table: string, columns: string) {
  const rows: Array<Record<string, unknown>> = [];
  const pageSize = 1_000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await database.from(table).select(columns).range(from, from + pageSize - 1);
    if (error) throw new Error(`Load ${table}: ${error.message}`);
    const page = (data ?? []) as unknown as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function selectFirstAvailable(database: SupabaseClient, table: string, columnSets: string[]) {
  let lastError: unknown;
  for (const columns of columnSets) {
    try {
      return await selectAll(database, table, columns);
    } catch (error) {
      if (!isMissingColumnError(error)) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`No supported ${table} inventory shape is available.`);
}

function isMissingColumnError(error: unknown) {
  return error instanceof Error
    && /column .* does not exist|could not find the .* column|schema cache/i.test(error.message);
}

async function updateAll(database: SupabaseClient, table: string, values: Record<string, unknown>, filterColumn: string) {
  const { error } = await database.from(table).update(values).not(filterColumn, "is", null);
  if (error) throw new Error(`Prepare ${table} for the prelaunch reset: ${error.message}`);
}

async function deleteAll(database: SupabaseClient, table: string, filterColumn: string) {
  const { error } = await database.from(table).delete().not(filterColumn, "is", null);
  if (error) throw new Error(`Reset ${table}: ${error.message}`);
}

function sortRows(rows: Array<Record<string, unknown>>) {
  return [...rows].sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
}

function parseArgs(args: string[]) {
  let apply = false;
  let confirmation: string | undefined;
  for (const arg of args) {
    if (arg === "--apply") { apply = true; continue; }
    if (arg.startsWith("--confirm=")) { confirmation = arg.slice("--confirm=".length); continue; }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!apply && confirmation) throw new Error("--confirm is valid only with --apply.");
  return { apply, confirmation };
}
