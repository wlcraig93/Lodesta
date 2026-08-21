import "./load-env";

import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { promisify } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "../lib/supabase/client";
import { sha256, stableJson } from "../packages/business-data";
import { workspaceSourceSidecarKey, type ArtifactBlobStoreName } from "../packages/site-artifacts";
import {
  configuredArtifactBlobMaintenanceStore,
  type ArtifactBlobMaintenanceStore
} from "../packages/site-artifacts/maintenance-store";
import {
  canonicalAuthoringEvidenceRegistryPath,
  configuredSiteEvidenceStore,
  createCanonicalAuthoringEvidenceBundle,
  readCanonicalAuthoringEvidenceRegistry,
  verifyCanonicalAuthoringEvidenceRegistry,
  type EvidenceBundleFile
} from "../packages/site-evidence";
import { platformCapabilityStylesFor } from "../workers/site-sandbox/scaffold/platform/capability-styles";
import fontCoverageManifest from "../workers/site-sandbox/scaffold/platform/font-coverage-manifest.json";

const execFile = promisify(execFileCallback);
const command = process.argv[2] ?? "verify";
const requestedRunId = process.argv.find((arg) => arg.startsWith("--run="))?.slice("--run=".length);
if (!new Set(["export", "verify"]).has(command)) throw new Error("Use export or verify.");

if (command === "verify") {
  process.stdout.write(`${JSON.stringify(await verifyCanonicalAuthoringEvidenceRegistry(), null, 2)}\n`);
} else {
  const database = getSupabaseAdminClient();
  const sourceStore = configuredArtifactBlobMaintenanceStore();
  const evidenceStore = configuredSiteEvidenceStore();
  const { registry } = await readCanonicalAuthoringEvidenceRegistry();
  const targets = registry.runs.filter((entry) => !requestedRunId || entry.runId === requestedRunId);
  if (!targets.length) throw new Error(`Unknown decisive run ${requestedRunId}.`);
  for (const entry of targets) {
    const sealed = await exportRun(database, sourceStore, entry);
    await evidenceStore.putImmutable({
      key: sealed.archive.key,
      bytes: sealed.bytes,
      contentType: "application/json",
      contentHash: sealed.archive.bundleHash
    });
    entry.archive = sealed.archive;
    process.stdout.write(`${JSON.stringify({ ok: true, runId: entry.runId, ...sealed.archive })}\n`);
  }
  await writeFile(canonicalAuthoringEvidenceRegistryPath, `${JSON.stringify(registry, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, registryPath: canonicalAuthoringEvidenceRegistryPath, exportedRuns: targets.length })}\n`);
}

async function exportRun(
  database: SupabaseClient,
  sourceStore: ArtifactBlobMaintenanceStore,
  entry: Awaited<ReturnType<typeof readCanonicalAuthoringEvidenceRegistry>>["registry"]["runs"][number]
) {
  const run = await selectMaybe(database, "site_agent_runs", "id", entry.runId);
  if (!run) {
    throw new Error(`canonical_authoring_evidence_source_incomplete:${entry.runId}:the hosted run graph is unavailable`);
  }
  const runDocument = record(run.run);
  const session = await selectOne(database, "site_agent_sessions", "id", stringValue(run.session_id));
  const site = await selectOne(database, "sites", "id", stringValue(run.site_id));
  const businessId = stringValue(site.business_id);
  const artifactId = stringValue(runDocument.outputArtifactId);
  const workspaceRevisionId = stringValue(runDocument.outputRevisionId ?? run.output_revision_id);
  const publicInputId = stringValue(runDocument.publicBuildInputId);
  const versionId = stringValue(runDocument.candidateVersionId);
  const artifact = await selectOne(database, "site_build_artifacts", "id", artifactId);
  const workspace = await selectOne(database, "site_workspace_revisions", "id", workspaceRevisionId);
  const publicInput = await selectOne(database, "site_public_build_inputs", "id", publicInputId);
  const version = await selectOne(database, "site_versions", "id", versionId);
  const runtimePatchId = stringValue(artifact.runtime_patch_at_finalization);
  const runtimePatch = await selectOne(database, "trusted_runtime_patches", "id", runtimePatchId);
  const runtimeSeries = await selectOne(database, "trusted_runtime_series", "id", stringValue(artifact.runtime_series_id));
  const inputSources = await selectMany(database, "site_public_build_input_sources", "input_id", publicInputId);
  const inputAssets = await selectMany(database, "site_public_build_input_assets", "input_id", publicInputId);
  const inputForms = await selectMany(database, "site_public_build_input_forms", "input_id", publicInputId);
  const sourceIds = inputSources.map((row) => stringValue(row.source_snapshot_id));
  const assetIds = inputAssets.map((row) => stringValue(row.asset_revision_id));
  const formIds = inputForms.map((row) => stringValue(row.form_definition_id));
  const [
    events,
    messages,
    checkpoints,
    continuationHeads,
    continuationSegments,
    bootstrapRequests,
    business,
    businessStates,
    intents,
    forms,
    assets,
    snapshots,
    versions,
    artifacts,
    sourceChildren
  ] = await Promise.all([
    selectMany(database, "site_agent_run_events", "run_id", entry.runId),
    selectMany(database, "site_agent_messages", "run_id", entry.runId),
    selectMany(database, "site_agent_workspace_checkpoints", "run_id", entry.runId),
    selectMany(database, "site_agent_continuation_heads", "run_id", entry.runId),
    selectMany(database, "site_agent_continuation_segments", "run_id", entry.runId),
    selectMany(database, "site_authoring_bootstrap_requests", "run_id", entry.runId),
    selectOne(database, "businesses", "id", businessId),
    selectMany(database, "business_states", "business_id", businessId),
    selectMany(database, "site_intents", "site_id", stringValue(site.id)),
    selectIn(database, "form_definitions", "id", formIds),
    selectIn(database, "asset_revisions", "id", assetIds),
    selectIn(database, "source_snapshots", "id", sourceIds),
    selectMany(database, "site_versions", "site_id", stringValue(site.id)),
    selectMany(database, "site_build_artifacts", "site_id", stringValue(site.id)),
    loadSourceChildren(database, sourceIds)
  ]);

  const files = new Map<string, { path: string; contentType: string; bytes: Buffer }>();
  const add = (path: string, bytes: Buffer, contentType = contentTypeFor(path)) => {
    if (files.has(path)) throw new Error(`Duplicate evidence path ${path}.`);
    files.set(path, { path, contentType, bytes });
  };
  const addJson = (path: string, value: unknown) => add(path, Buffer.from(stableJson(value)), "application/json");

  addJson("database/run.json", run);
  addJson("database/session.json", session);
  addJson("database/events.json", events);
  addJson("database/messages.json", messages);
  addJson("database/checkpoints.json", checkpoints);
  addJson("database/continuations.json", { heads: continuationHeads, segments: continuationSegments });
  addJson("database/bootstrap-requests.json", bootstrapRequests);
  addJson("database/site.json", site);
  addJson("database/business.json", business);
  addJson("database/business-states.json", businessStates);
  addJson("database/site-intents.json", intents);
  addJson("database/public-input.json", publicInput);
  addJson("database/public-input-associations.json", { sources: inputSources, assets: inputAssets, forms: inputForms });
  addJson("database/forms.json", forms);
  addJson("database/assets.json", assets);
  addJson("database/source-snapshots.json", snapshots);
  addJson("database/source-children.json", sourceChildren);
  addJson("database/workspace-revision.json", workspace);
  addJson("database/artifact.json", artifact);
  addJson("database/version.json", version);
  addJson("database/site-versions.json", versions);
  addJson("database/site-artifacts.json", artifacts);
  addJson("database/runtime-series.json", runtimeSeries);
  addJson("database/runtime-patch.json", runtimePatch);
  addJson("provenance/identities.json", {
    skillVersions: runDocument.skillVersions,
    modelId: run.model_id,
    apiProvider: run.api_provider,
    authoringProfileId: runDocument.authoringProfileId,
    toolchainIdentity: artifact.toolchain_version,
    sandboxImageDigest: artifact.sandbox_image_digest,
    runtimeSeriesId: artifact.runtime_series_id,
    runtimePatchId
  });

  const sourceArchiveKey = stringValue(workspace.source_archive_key);
  await addStored(sourceStore, "workspace", sourceArchiveKey, `workspace/${sourceArchiveKey}`, add);
  const sidecarKey = workspaceSourceSidecarKey(sourceArchiveKey);
  await addStored(sourceStore, "artifact", sidecarKey, `workspace/${sidecarKey}`, add);
  await addStored(sourceStore, "artifact", stringValue(runtimePatch.storage_key), "runtime/runtime.js", add);

  const artifactPrefix = stringValue(artifact.storage_prefix).replace(/\/$/, "");
  await addPrefix(sourceStore, "artifact", artifactPrefix, "artifact", add);
  const screenshotKeys = Array.isArray(runDocument.screenshotKeys) ? runDocument.screenshotKeys.filter((value): value is string => typeof value === "string") : [];
  for (const key of screenshotKeys) await addStored(sourceStore, "artifact", key, `captures/${key.split("/").at(-1)}`, add);
  for (const asset of assets) {
    const key = typeof asset.storage_path === "string" ? asset.storage_path : undefined;
    if (key) {
      const extension = extname(key).toLowerCase();
      await addStored(sourceStore, "artifact", key, `assets/by-revision/${stringValue(asset.id)}${extension}`, add);
    }
  }
  for (const key of referencedStorageKeys(sourceChildren)) {
    const blob = await getFromEither(sourceStore, key);
    if (!blob) throw new Error(`Referenced source object ${key} is missing.`);
    add(`sources/objects/${key.replace(/[^a-zA-Z0-9_.-]/g, "_")}`, blob.bytes, blob.contentType);
  }

  const originalFontFilenames = [
    "inter-latin-variable.woff2",
    "figtree-latin-variable.woff2",
    "manrope-latin-variable.woff2",
    "newsreader-latin-variable.woff2",
    "fraunces-latin-variable.woff2",
    "roboto-condensed-latin-variable.woff2"
  ];
  for (const filename of originalFontFilenames) add(`fonts/original/${filename}`, await readFile(`public/_lodesta/fonts/${filename}`), "font/woff2");
  addJson("fonts/original/coverage-manifest.json", {
    schemaVersion: 1,
    fonts: fontCoverageManifest.fonts.filter((font) => originalFontFilenames.includes(font.filename))
  });
  add("evaluation/EVALUATION.md", await readFile(".design/canonical-authoring-bakeoff/EVALUATION.md"), "text/markdown");
  add("provenance/retained-control-profile.ts", await readFile(".design/canonical-authoring-bakeoff/retained-control-profile.ts"), "text/plain");
  add("provenance/historical-skills.ts", Buffer.from((await execFile("git", ["show", "0cc47bfa:packages/site-agent/skills.ts"])).stdout), "text/plain");
  add("provenance/executable-prompt.ts", Buffer.from((await execFile("git", ["show", "0cc47bfa:packages/site-agent/prompts.ts"])).stdout), "text/plain");
  add("provenance/capability-styles.css", Buffer.from(platformCapabilityStylesFor(stringValue(artifact.runtime_series_id))), "text/css");

  const created = createCanonicalAuthoringEvidenceBundle({
    runId: entry.runId,
    business: entry.business,
    treatment: entry.treatment,
    knownGlyphFindings: entry.knownGlyphFindings,
    files: [...files.values()]
  });
  const bundleHash = sha256(created.bytes);
  const archive = {
    key: `canonical-authoring-evidence/${entry.runId}/${bundleHash.slice(7)}.json`,
    bytes: created.bytes.byteLength,
    bundleHash,
    artifactHash: stringValue(artifact.artifact_hash) as `sha256:${string}`,
    runtimeIdentity: `${artifact.runtime_series_id}:${runtimePatch.id}:${runtimePatch.content_hash}`
  };
  assert.match(archive.artifactHash, /^sha256:[a-f0-9]{64}$/);
  return { archive, bytes: created.bytes };
}

async function addPrefix(
  store: ArtifactBlobMaintenanceStore,
  storeName: ArtifactBlobStoreName,
  prefix: string,
  destination: string,
  add: (path: string, bytes: Buffer, contentType?: string) => void
) {
  let cursor: string | undefined;
  let count = 0;
  do {
    const page = await store.listPage(storeName, { prefix, cursor, limit: 1000 });
    for (const object of page.objects) {
      const blob = await store.get(storeName, object.key);
      if (!blob) throw new Error(`Listed ${storeName} object ${object.key} disappeared.`);
      const relative = object.key.slice(prefix.length).replace(/^\//, "");
      add(`${destination}/${relative}`, blob.bytes, blob.contentType);
      count += 1;
    }
    cursor = page.cursor;
    if (page.truncated && !cursor) throw new Error(`Truncated ${storeName} prefix lacked a cursor.`);
  } while (cursor);
  if (!count) throw new Error(`No objects found for ${storeName}:${prefix}.`);
}

async function addStored(
  store: ArtifactBlobMaintenanceStore,
  storeName: ArtifactBlobStoreName,
  key: string,
  destination: string,
  add: (path: string, bytes: Buffer, contentType?: string) => void
) {
  const blob = await store.get(storeName, key);
  if (!blob) throw new Error(`Required ${storeName} object ${key} is missing.`);
  add(destination, blob.bytes, blob.contentType);
}

async function getFromEither(store: ArtifactBlobMaintenanceStore, key: string) {
  return await store.get("artifact", key) ?? await store.get("workspace", key);
}

async function loadSourceChildren(database: SupabaseClient, sourceIds: string[]) {
  return Object.fromEntries(await Promise.all([
    "source_snapshot_chunks",
    "source_snapshot_objects",
    "source_snapshot_pages",
    "source_snapshot_resources",
    "source_snapshot_mirror_references"
  ].map(async (table) => [table, await selectInOptional(database, table, "source_snapshot_id", sourceIds)])));
}

function referencedStorageKeys(value: unknown) {
  const keys = new Set<string>();
  const visit = (current: unknown, name = "") => {
    if (typeof current === "string" && /(?:storage|blob|object)_(?:key|path)$/.test(name) && !/^https?:/i.test(current)) keys.add(current);
    else if (Array.isArray(current)) current.forEach((item) => visit(item, name));
    else if (current && typeof current === "object") Object.entries(current).forEach(([key, item]) => visit(item, key));
  };
  visit(value);
  return [...keys].sort();
}

async function selectOne(database: SupabaseClient, table: string, column: string, value: string) {
  const { data, error } = await database.from(table).select("*").eq(column, value).maybeSingle();
  if (error) throw new Error(`Load ${table}:${value}: ${error.message}`);
  if (!data) throw new Error(`Missing ${table}:${value}.`);
  return data as Record<string, unknown>;
}

async function selectMaybe(database: SupabaseClient, table: string, column: string, value: string) {
  const { data, error } = await database.from(table).select("*").eq(column, value).maybeSingle();
  if (error) throw new Error(`Load ${table}:${value}: ${error.message}`);
  return data as Record<string, unknown> | null;
}

async function selectMany(database: SupabaseClient, table: string, column: string, value: string) {
  const { data, error } = await database.from(table).select("*").eq(column, value);
  if (error) throw new Error(`Load ${table} for ${value}: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

async function selectIn(database: SupabaseClient, table: string, column: string, values: string[]) {
  if (!values.length) return [];
  const rows: Array<Record<string, unknown>> = [];
  for (let index = 0; index < values.length; index += 100) {
    const { data, error } = await database.from(table).select("*").in(column, values.slice(index, index + 100));
    if (error) throw new Error(`Load ${table}: ${error.message}`);
    rows.push(...(data ?? []) as Array<Record<string, unknown>>);
  }
  return rows;
}

async function selectInOptional(database: SupabaseClient, table: string, column: string, values: string[]) {
  try {
    return await selectIn(database, table, column, values);
  } catch (error) {
    if (error instanceof Error && /could not find the table|relation .* does not exist|schema cache/i.test(error.message)) return [];
    throw error;
  }
}

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected retained object payload.");
  return value as Record<string, unknown>;
}

function stringValue(value: unknown) {
  if (typeof value !== "string" || !value) throw new Error("Expected retained string identity.");
  return value;
}

function contentTypeFor(path: string) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".woff2": "font/woff2",
    ".gz": "application/gzip"
  } as Record<string, string>)[extname(path).toLowerCase()] ?? "application/octet-stream";
}
