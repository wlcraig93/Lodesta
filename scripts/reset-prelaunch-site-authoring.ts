import "./load-env";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "../lib/supabase/client";
import { sha256, stableJson } from "../packages/business-data";
import { siteSandboxDeploymentSchema } from "../packages/site-contracts";
import { configuredSiteSandboxClientForDeployment, isConfirmedSandboxAbsent } from "../packages/site-sandbox";
import { verifyCanonicalAuthoringEvidenceRegistry } from "../packages/site-evidence";

const reportPath = resolve(process.cwd(), ".data/maintenance/site-authoring-reset.json");
const removedPrelaunchTables = [
  "source_snapshot_chunks",
  "source_snapshot_objects",
  "source_snapshot_pages",
  "source_snapshot_resources",
  "site_version_source_coverage",
  "site_version_redirects",
  "vertical_demand_events"
] as const;
const removedPrelaunchTableKeys: Record<(typeof removedPrelaunchTables)[number], string> = {
  source_snapshot_objects: "id",
  source_snapshot_chunks: "id",
  source_snapshot_resources: "id",
  source_snapshot_pages: "id",
  site_version_source_coverage: "version_id",
  site_version_redirects: "id",
  vertical_demand_events: "id"
};
const requiredLiveDependencyTables = [
  "site_agent_workspace_checkpoints",
  "analytics_collection_daily",
  "source_snapshot_mirror_references"
] as const;
const requiredRetiredTables = [
  "website_setups",
  "authoring_outbox",
  "generation_experiment_runs",
  "model_bakeoff_runs",
  "external_authoring_batch_items",
  "external_authoring_executions",
  "authoring_execution_bundles",
  "staged_blob_receipts",
  "prospect_observations"
] as const;
const preservedTables = [
  "prospects",
  "prospect_locations",
  "prospect_contacts",
  "prospect_reports",
  "prospect_report_leads",
  "prospect_report_access_grants",
  "outbound_campaigns",
  "outbound_prospects",
  "outbound_events"
] as const;
const additionalResetTables = [
  "businesses",
  "business_states",
  "site_intents",
  "form_definitions",
  "site_public_build_inputs",
  "site_public_build_input_sources",
  "site_public_build_input_assets",
  "site_public_build_input_forms",
  "site_version_sources",
  "site_version_assets",
  "site_version_forms",
  "site_agent_messages",
  "site_agent_run_events",
  "control_plane_change_requests",
  "site_operator_queue",
  "preview_grants",
  "active_domains",
  "domains",
  "adoption_invitations",
  "site_redirects",
  "inquiry_events",
  "inquiries",
  "analytics_events"
] as const;
const options = parseArgs(process.argv.slice(2));
const client = getSupabaseAdminClient();

if (options.schemaOnly) {
  await assertLiveSchemaContract(client);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: "schema-only",
    requiredLiveTables: requiredLiveDependencyTables,
    requiredRetiredTables
  }, null, 2)}\n`);
} else if (!options.apply) {
  const report = await createReport(client);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: "report",
    reportPath,
    confirmation: confirmationFor(report),
    reportHash: report.reportHash,
    counts: report.counts,
    activeRuns: report.activeRuns,
    preservedDigests: report.preservedDigests,
    evidence: {
      registryHash: report.evidence.registryHash,
      sealedRuns: report.evidence.sealedRuns
    }
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
  await destroySandboxes(client, fresh.sessions);
  await resetGeneratedSiteRows(client);
  const post = await createReport(client);
  if (Object.values(post.counts).some((count) => count !== 0)) {
    throw new Error(`Generated-site reset was incomplete: ${JSON.stringify(post.counts)}.`);
  }
  if (stableJson(post.preservedDigests) !== stableJson(reviewed.preservedDigests)) {
    throw new Error("Preserved prospect or campaign data changed outside the three declared nullable site references.");
  }
  await assertDetachedPreservedSiteReferences(client);
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
  dependencyTables: Record<(typeof requiredLiveDependencyTables)[number], Array<Record<string, unknown>>>;
  tableInventories: Record<string, { count: number; targetIdDigest: `sha256:${string}`; rowDigest: `sha256:${string}`; sampleIds: string[] }>;
  preservedDigests: Record<(typeof preservedTables)[number], { count: number; digest: `sha256:${string}` }>;
  evidence: Awaited<ReturnType<typeof verifyCanonicalAuthoringEvidenceRegistry>>;
  bootstrapRequests: Array<Record<string, unknown>>;
  siteAssessments: Array<Record<string, unknown>>;
  siteAssessmentJobs: Array<Record<string, unknown>>;
};

async function createReport(database: SupabaseClient): Promise<ResetReport> {
  await assertLiveSchemaContract(database);
  // The reset report intentionally reads the full retained corpus. Keep these
  // reads serialized so the operator cannot exhaust the hosted statement
  // budget by fanning out dozens of exact inventories at once.
  const sites = await selectAll(database, "sites", "id,slug,business_id,owner_user_id,source_url,status,published_version_id,current_workspace_revision_id,current_public_build_input_id");
  const versions = await selectAll(database, "site_versions", "id,site_id,status,schema_version,artifact_id,workspace_revision_id,public_build_input_id");
  const artifacts = await selectAll(database, "site_build_artifacts", "id,site_id,toolchain_version,sandbox_image_digest,storage_prefix");
  const workspaces = await selectAll(database, "site_workspace_revisions", "id,site_id,source_archive_key,source_hash");
  const assets = await selectFirstAvailable(database, "asset_revisions", [
    "id,asset_id,business_id,storage_path,origin",
    "id,asset_id,business_id,storage_path,rights_status"
  ]);
  const snapshots = await selectAll(database, "source_snapshots", "id,business_id,source_type,content_hash");
  const sessions = await selectAll(database, "site_agent_sessions", "id,site_id,status,sandbox_id,sandbox_deployment_id");
  const runs = await selectAll(database, "site_agent_runs", "id,site_id,session_id,status,kind");
  const continuationHeads = await selectAll(database, "site_agent_continuation_heads", "run_id,status,latest_sequence,purge_after");
  const continuationSegments = await selectAll(database, "site_agent_continuation_segments", "id,run_id,generation,sequence");
  const bootstrapRequests = await selectAll(database, "site_authoring_bootstrap_requests", "owner_user_id,site_id,run_id,created_at");
  const assessments = await selectAll(database, "website_assessments", "id,target_kind,source_key,site_id,artifact_id,version_id");
  const assessmentJobs = await selectAll(database, "website_assessment_jobs", "id,assessment_id,status");
  const checkpointRows = await selectAll(database, "site_agent_workspace_checkpoints", "*");
  const analyticsDailyRows = await selectAll(database, "analytics_collection_daily", "*");
  const mirrorReferenceRows = await selectAll(database, "source_snapshot_mirror_references", "*");
  const evidence = await verifyCanonicalAuthoringEvidenceRegistry();
  const preservedRows = await selectTablesSequentially(database, preservedTables, "*", 250);
  const additionalResetRows = await selectTablesSequentially(database, additionalResetTables, "*", 250);
  const extendedTableRows = await selectOptionalTablesSequentially(database, removedPrelaunchTables, 250);
  const extendedTables = Object.fromEntries(removedPrelaunchTables.map((table, index) => [
    table,
    sortRows(extendedTableRows[index] ?? [])
  ])) as Record<(typeof removedPrelaunchTables)[number], Array<Record<string, unknown>>>;
  const siteAssessments = assessments.filter((row) => typeof row.site_id === "string");
  const siteAssessmentIds = new Set(siteAssessments.map((row) => row.id));
  const siteAssessmentJobs = assessmentJobs.filter((row) => siteAssessmentIds.has(row.assessment_id));
  const dependencyTables = {
    site_agent_workspace_checkpoints: sortRows(checkpointRows),
    analytics_collection_daily: sortRows(analyticsDailyRows),
    source_snapshot_mirror_references: sortRows(mirrorReferenceRows)
  } satisfies ResetReport["dependencyTables"];
  const preservedDigests = Object.fromEntries(preservedTables.map((table, index) => [
    table,
    preservedDigest(table, preservedRows[index] ?? [])
  ])) as ResetReport["preservedDigests"];
  const inventoryRows: Record<string, Array<Record<string, unknown>>> = {
    sites,
    site_versions: versions,
    site_build_artifacts: artifacts,
    site_workspace_revisions: workspaces,
    asset_revisions: assets,
    source_snapshots: snapshots,
    site_agent_sessions: sessions,
    site_agent_runs: runs,
    site_agent_continuation_heads: continuationHeads,
    site_agent_continuation_segments: continuationSegments,
    site_authoring_bootstrap_requests: bootstrapRequests,
    website_assessments: siteAssessments,
    website_assessment_jobs: siteAssessmentJobs,
    ...dependencyTables,
    ...Object.fromEntries(additionalResetTables.map((table, index) => [table, additionalResetRows[index] ?? []])),
    ...extendedTables
  };
  const tableInventories = Object.fromEntries(Object.entries(inventoryRows).map(([table, rows]) => [
    table,
    tableInventory(rows)
  ]));
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
      continuationHeads: continuationHeads.length,
      continuationSegments: continuationSegments.length,
      bootstrapRequests: bootstrapRequests.length,
      siteAssessments: siteAssessments.length,
      siteAssessmentJobs: siteAssessmentJobs.length,
      ...Object.fromEntries(requiredLiveDependencyTables.map((table) => [table, dependencyTables[table].length])),
      ...Object.fromEntries(additionalResetTables.map((table, index) => [table, (additionalResetRows[index] ?? []).length])),
      ...Object.fromEntries(removedPrelaunchTables.map((table) => [table, extendedTables[table].length]))
    },
    sites: sortRows(sites),
    versions: sortRows(versions),
    artifacts: sortRows(artifacts),
    workspaces: sortRows(workspaces),
    assets: sortRows(assets),
    snapshots: sortRows(snapshots),
    sessions: sortRows(sessions),
    runs: sortRows(runs),
    activeRuns: sortRows(runs.filter((row) => row.status === "queued" || row.status === "running" || row.status === "needs_input")),
    dependencyTables,
    tableInventories,
    preservedDigests,
    evidence,
    bootstrapRequests: sortRows(bootstrapRequests),
    siteAssessments: sortRows(siteAssessments),
    siteAssessmentJobs: sortRows(siteAssessmentJobs)
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

async function destroySandboxes(database: SupabaseClient, sessions: Array<Record<string, unknown>>) {
  const retained = sessions.filter((session) => typeof session.sandbox_id === "string" && session.sandbox_id.length > 0);
  if (!retained.length) return;
  const clients = new Map<string, ReturnType<typeof configuredSiteSandboxClientForDeployment>>();
  for (const session of retained) {
    const sandboxId = typeof session.sandbox_id === "string" ? session.sandbox_id : undefined;
    const deploymentId = typeof session.sandbox_deployment_id === "string" ? session.sandbox_deployment_id : undefined;
    if (!sandboxId || !deploymentId) throw new Error("Cutover report contains a live sandbox without immutable deployment provenance.");
    let sandbox = clients.get(deploymentId);
    if (!sandbox) {
      const { data, error } = await database.from("site_sandbox_deployments")
        .select("deployment")
        .eq("id", deploymentId)
        .single();
      if (error) throw new Error(`Load sandbox deployment ${deploymentId}: ${error.message}`);
      sandbox = configuredSiteSandboxClientForDeployment(siteSandboxDeploymentSchema.parse(data?.deployment));
      clients.set(deploymentId, sandbox);
    }
    try {
      await sandbox.destroy(sandboxId);
    } catch (error) {
      if (!isConfirmedSandboxAbsent(error)) throw error;
    }
  }
}

async function resetGeneratedSiteRows(database: SupabaseClient) {
  await updateAll(database, "outbound_events", { site_id: null }, "id");
  await updateAll(database, "outbound_prospects", { site_id: null, preview_id: null }, "id");
  await updateAll(database, "sites", {
    published_version_id: null,
    current_workspace_revision_id: null,
    current_public_build_input_id: null
  }, "id");
  await updateAll(database, "site_versions", { replaced_version_id: null }, "id");
  await updateAll(database, "site_workspace_revisions", { parent_revision_id: null }, "id");
  await updateAll(database, "site_agent_runs", { resume_checkpoint_id: null }, "id");
  await deleteSiteAssessments(database);
  for (const table of removedPrelaunchTables) await deleteOptionalTable(database, table);

  for (const [table, filterColumn] of [
    ["preview_grants", "id"],
    ["active_domains", "hostname"],
    ["domains", "id"],
    ["adoption_invitations", "id"],
    ["site_redirects", "id"],
    ["inquiry_events", "id"],
    ["inquiries", "id"],
    ["analytics_events", "id"],
    ["analytics_collection_daily", "site_id"],
    ["control_plane_change_requests", "id"],
    ["site_operator_queue", "id"],
    ["site_agent_run_events", "id"],
    ["site_agent_messages", "id"],
    ["site_agent_workspace_checkpoints", "id"],
    ["site_agent_continuation_segments", "id"],
    ["site_agent_continuation_heads", "run_id"],
    ["site_authoring_bootstrap_requests", "owner_user_id"],
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
    ["source_snapshot_mirror_references", "source_snapshot_id"],
    ["source_snapshots", "id"],
    ["sites", "id"],
    ["businesses", "id"]
  ] as const) {
    await deleteAll(database, table, filterColumn);
  }
}

async function deleteSiteAssessments(database: SupabaseClient) {
  const assessments = (await selectAll(
    database,
    "website_assessments",
    "id,site_id"
  )).filter((row): row is Record<string, unknown> & { id: string } =>
    typeof row.id === "string" && typeof row.site_id === "string");
  const assessmentIds = assessments.map((assessment) => assessment.id);
  if (!assessmentIds.length) return;

  const reports = await selectAll(database, "prospect_reports", "id,assessment_id");
  const assessmentIdSet = new Set(assessmentIds);
  const prospectReferences = reports.filter((row) =>
    typeof row.assessment_id === "string" && assessmentIdSet.has(row.assessment_id));
  if (prospectReferences.length) {
    throw new Error(
      `${prospectReferences.length} prospect record(s) reference generated-site assessments; explicit prospect disposition is required.`
    );
  }
  await deleteByValues(database, "website_assessment_jobs", "assessment_id", assessmentIds);
  await deleteByValues(database, "website_assessments", "id", assessmentIds);
}

async function selectAll(database: SupabaseClient, table: string, columns: string, pageSize = 250) {
  const { data: probeData, error: probeError } = await database.from(table).select(columns).limit(1);
  if (probeError) throw new Error(`Load ${table}: ${probeError.message}`);
  const probe = ((probeData ?? []) as unknown as Array<Record<string, unknown>>)[0];
  if (!probe) return [];
  const orderColumns = stableInventoryOrderColumns(probe);
  if (orderColumns.length === 1 && orderColumns[0] === "id") {
    return selectAllById(database, table, columns, pageSize);
  }
  const rows: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += pageSize) {
    let query = database.from(table).select(columns);
    for (const column of orderColumns) {
      query = query.order(column, { ascending: true, nullsFirst: true });
    }
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw new Error(`Load ${table}: ${error.message}`);
    const page = (data ?? []) as unknown as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function selectAllById(database: SupabaseClient, table: string, columns: string, pageSize: number) {
  const rows: Array<Record<string, unknown>> = [];
  let lastId: string | number | undefined;
  for (;;) {
    let query = database.from(table).select(columns).order("id", { ascending: true }).limit(pageSize);
    if (lastId !== undefined) query = query.gt("id", lastId);
    const { data, error } = await query;
    if (error) throw new Error(`Load ${table}: ${error.message}`);
    const page = (data ?? []) as unknown as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < pageSize) return rows;
    const nextId = page.at(-1)?.id;
    if (typeof nextId !== "string" && typeof nextId !== "number") {
      throw new Error(`Load ${table}: deterministic id pagination requires a scalar id.`);
    }
    if (nextId === lastId) throw new Error(`Load ${table}: deterministic id pagination did not advance.`);
    lastId = nextId;
  }
}

function stableInventoryOrderColumns(probe: Record<string, unknown>) {
  if (Object.hasOwn(probe, "id")) return ["id"];
  const identifiers = Object.keys(probe)
    .filter((column) => column === "hostname" || column === "sequence" || column === "generation" || /_id$/.test(column))
    .sort();
  if (identifiers.length) return identifiers;
  // Every retained table has a scalar primary or unique key. Falling back to
  // every selected column keeps report pagination deterministic if a future
  // table does not follow Lodesta's identifier naming convention.
  return Object.keys(probe).sort();
}

async function selectTablesSequentially(
  database: SupabaseClient,
  tables: readonly string[],
  columns: string,
  pageSize: number
) {
  const rows: Array<Array<Record<string, unknown>>> = [];
  for (const table of tables) rows.push(await selectAll(database, table, columns, pageSize));
  return rows;
}

async function selectOptionalTablesSequentially(
  database: SupabaseClient,
  tables: readonly string[],
  pageSize: number
) {
  const rows: Array<Array<Record<string, unknown>>> = [];
  for (const table of tables) rows.push(await selectOptionalTable(database, table, pageSize));
  return rows;
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

async function selectOptionalTable(database: SupabaseClient, table: string, pageSize = 1_000) {
  try {
    return await selectAll(database, table, "*", pageSize);
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
}

function isMissingTableError(error: unknown) {
  return error instanceof Error
    && /relation .* does not exist|could not find the table|schema cache/i.test(error.message);
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
  const batchSize = 200;
  for (;;) {
    const { data, error: selectError } = await database.from(table)
      .select(filterColumn)
      .not(filterColumn, "is", null)
      .limit(batchSize);
    if (selectError) throw new Error(`Reset ${table}: ${selectError.message}`);
    const values = [...new Set(((data ?? []) as unknown as Array<Record<string, unknown>>)
      .map((row) => row[filterColumn])
      .filter((value): value is string | number => typeof value === "string" || typeof value === "number"))];
    if (!values.length) return;
    const { error: deleteError } = await database.from(table).delete().in(filterColumn, values);
    if (deleteError) throw new Error(`Reset ${table}: ${deleteError.message}`);
  }
}

async function deleteOptionalTable(database: SupabaseClient, table: string) {
  const key = removedPrelaunchTableKeys[table as keyof typeof removedPrelaunchTableKeys];
  if (!key) throw new Error(`No reset key is declared for ${table}.`);
  try {
    await deleteAll(database, table, key);
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
  }
}

async function deleteByValues(database: SupabaseClient, table: string, column: string, values: string[]) {
  const chunkSize = 100;
  for (let index = 0; index < values.length; index += chunkSize) {
    const { error } = await database.from(table).delete().in(column, values.slice(index, index + chunkSize));
    if (error) throw new Error(`Reset ${table}: ${error.message}`);
  }
}

function sortRows(rows: Array<Record<string, unknown>>) {
  return [...rows].sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
}

function tableInventory(rows: Array<Record<string, unknown>>) {
  const sortedRows = sortRows(rows);
  const targetIds = sortedRows.map((row) => {
    const primary = row.id ?? row.hostname ?? row.run_id ?? row.version_id ?? row.business_id
      ?? row.site_id ?? row.source_snapshot_id ?? row.owner_user_id ?? "row";
    return `${String(primary)}:${sha256(stableJson(row)).slice(7, 19)}`;
  }).sort();
  return {
    count: sortedRows.length,
    targetIdDigest: sha256(stableJson(targetIds)),
    rowDigest: sha256(stableJson(sortedRows)),
    sampleIds: targetIds.slice(0, 25)
  };
}

function preservedDigest(table: (typeof preservedTables)[number], rows: Array<Record<string, unknown>>) {
  const normalized = rows.map((row) => {
    const value = { ...row };
    if (table === "outbound_prospects") {
      delete value.site_id;
      delete value.preview_id;
    }
    if (table === "outbound_events") delete value.site_id;
    return value;
  });
  return { count: rows.length, digest: sha256(stableJson(sortRows(normalized))) };
}

async function assertLiveSchemaContract(database: SupabaseClient) {
  const statuses = await Promise.all([
    ...requiredLiveDependencyTables.map(async (table) => {
      const { count, error } = await database.from(table).select("*", { count: "exact" }).limit(1);
      return { table, expected: "live" as const, present: !error, count: error ? undefined : count, errorCode: error?.code };
    }),
    ...requiredRetiredTables.map(async (table) => {
      const { count, error } = await database.from(table).select("*", { count: "exact" }).limit(1);
      return { table, expected: "absent" as const, present: !error, count: error ? undefined : count, errorCode: error?.code };
    })
  ]);
  const mismatches = statuses.filter((status) => status.expected === "live" ? !status.present : status.present);
  if (mismatches.length) {
    throw new Error(`prelaunch_reset_live_schema_mismatch:${JSON.stringify({ statuses, mismatches })}`);
  }
}

async function assertDetachedPreservedSiteReferences(database: SupabaseClient) {
  const [prospects, events] = await Promise.all([
    selectAll(database, "outbound_prospects", "id,site_id,preview_id"),
    selectAll(database, "outbound_events", "id,site_id")
  ]);
  const attachedProspects = prospects.filter((row) => row.site_id !== null || row.preview_id !== null);
  const attachedEvents = events.filter((row) => row.site_id !== null);
  if (attachedProspects.length || attachedEvents.length) {
    throw new Error(`Preserved outbound records still reference deleted generated-site data (${attachedProspects.length} prospect, ${attachedEvents.length} event).`);
  }
}

function parseArgs(args: string[]) {
  let apply = false;
  let schemaOnly = false;
  let confirmation: string | undefined;
  for (const arg of args) {
    if (arg === "--apply") { apply = true; continue; }
    if (arg === "--schema-only") { schemaOnly = true; continue; }
    if (arg.startsWith("--confirm=")) { confirmation = arg.slice("--confirm=".length); continue; }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (apply && schemaOnly) throw new Error("--schema-only cannot be combined with --apply.");
  if (!apply && confirmation) throw new Error("--confirm is valid only with --apply.");
  return { apply, schemaOnly, confirmation };
}
