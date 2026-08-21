import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256, stableJson } from "@/packages/business-data";
import { workspaceSourceSidecarKey, workspaceSourceSidecarSchema } from "@/packages/site-artifacts";
import { configuredSiteEvidenceStore, type SiteEvidenceStore } from "./store";

export const canonicalAuthoringEvidenceRegistryPath = resolve(
  process.cwd(),
  ".design/canonical-authoring-bakeoff/evidence-registry.json"
);

export type EvidenceBundleFile = {
  path: string;
  contentType: string;
  bytes: number;
  sha256: `sha256:${string}`;
  contentBase64: string;
};

export type CanonicalAuthoringEvidenceBundle = {
  schemaVersion: 1;
  kind: "canonical-authoring-evidence-bundle";
  runId: string;
  business: "kind" | "surge";
  treatment: "r8-control" | "optimized-v4";
  knownGlyphFindings: Array<{ character: string; codepoint: string; location: string }>;
  manifest: {
    files: Array<{ path: string; contentType: string; bytes: number; sha256: `sha256:${string}` }>;
    overallHash: `sha256:${string}`;
  };
  files: EvidenceBundleFile[];
};

type EvidenceRegistry = {
  schemaVersion: 1;
  kind: "canonical-authoring-evidence-registry";
  retention: {
    provider: "github-release";
    repository: string;
    releaseTag: string;
    visibility: "private";
    verifiedAt: string;
    assets: number;
    bytes: number;
  };
  runs: Array<{
    runId: string;
    business: "kind" | "surge";
    treatment: "r8-control" | "optimized-v4";
    knownGlyphFindings: Array<{ character: string; codepoint: string; location: string }>;
    archive: null | {
      key: string;
      bytes: number;
      bundleHash: `sha256:${string}`;
      artifactHash: `sha256:${string}`;
      runtimeIdentity: string;
    };
  }>;
};

const expectedRunIds = [
  "run_c0d04e7292b84ae5981654959cafdc4a",
  "run_9aa92465f7f74955ac76632128211f96",
  "run_ddbf867f44a542e1b41a2fb9397d92c3",
  "run_fe8092f18990423ab875a21cbb4d24c3",
  "run_07b17e4678b24fe9bcbd18928ea1ecc3",
  "run_cd6c6dc8abea4aa7b8008be84a58b5b5",
  "run_d6f0ebc5250142a9a218ca653170e627",
  "run_fb98492673ba4085879c9794726b74c7"
] as const;

export async function readCanonicalAuthoringEvidenceRegistry() {
  const bytes = await readFile(canonicalAuthoringEvidenceRegistryPath);
  const registry = JSON.parse(bytes.toString("utf8")) as EvidenceRegistry;
  if (registry.schemaVersion !== 1 || registry.kind !== "canonical-authoring-evidence-registry") {
    throw new Error("Canonical authoring evidence registry has an unsupported shape.");
  }
  const retainedBytes = registry.runs.reduce((total, run) => total + (run.archive?.bytes ?? 0), 0);
  if (
    registry.retention.provider !== "github-release"
    || registry.retention.visibility !== "private"
    || !registry.retention.repository
    || !registry.retention.releaseTag
    || !Number.isFinite(Date.parse(registry.retention.verifiedAt))
    || registry.retention.assets !== registry.runs.length
    || registry.retention.bytes !== retainedBytes
  ) {
    throw new Error("Canonical authoring evidence retention metadata is invalid.");
  }
  const runIds = registry.runs.map((run) => run.runId);
  if (new Set(runIds).size !== runIds.length || stableJson([...runIds].sort()) !== stableJson([...expectedRunIds].sort())) {
    throw new Error("Canonical authoring evidence registry does not name exactly the eight decisive runs.");
  }
  return { registry, registryHash: sha256(bytes) };
}

export async function verifyCanonicalAuthoringEvidenceRegistry(input: { store?: SiteEvidenceStore } = {}) {
  const { registry, registryHash } = await readCanonicalAuthoringEvidenceRegistry();
  const unsealed = registry.runs.filter((run) => !run.archive).map((run) => run.runId);
  if (unsealed.length) throw new Error(`canonical_authoring_evidence_unsealed:${unsealed.join(",")}`);
  const store = input.store ?? configuredSiteEvidenceStore();
  const bundles = [];
  for (const entry of registry.runs) {
    const archive = entry.archive!;
    const blob = await store.get(archive.key);
    if (!blob) throw new Error(`canonical_authoring_evidence_missing:${entry.runId}:${archive.key}`);
    if (blob.bytes.byteLength !== archive.bytes || sha256(blob.bytes) !== archive.bundleHash) {
      throw new Error(`canonical_authoring_evidence_archive_mismatch:${entry.runId}`);
    }
    const bundle = verifyCanonicalAuthoringEvidenceBundle(blob.bytes);
    const provenance = verifyCanonicalAuthoringEvidenceProvenance(bundle);
    if (
      bundle.runId !== entry.runId
      || bundle.business !== entry.business
      || bundle.treatment !== entry.treatment
      || stableJson(bundle.knownGlyphFindings) !== stableJson(entry.knownGlyphFindings)
      || provenance.artifactHash !== archive.artifactHash
      || provenance.runtimeIdentity !== archive.runtimeIdentity
    ) throw new Error(`canonical_authoring_evidence_registry_mismatch:${entry.runId}`);
    bundles.push({
      runId: entry.runId,
      key: archive.key,
      bytes: archive.bytes,
      bundleHash: archive.bundleHash,
      manifestHash: bundle.manifest.overallHash,
      files: bundle.files.length,
      artifactHash: archive.artifactHash,
      runtimeIdentity: archive.runtimeIdentity
    });
  }
  return { ok: true as const, registryHash, sealedRuns: bundles.length, bundles };
}

export function createCanonicalAuthoringEvidenceBundle(input: Omit<CanonicalAuthoringEvidenceBundle, "schemaVersion" | "kind" | "manifest" | "files"> & {
  files: Array<{ path: string; contentType: string; bytes: Buffer }>;
}) {
  const paths = input.files.map((file) => file.path);
  if (new Set(paths).size !== paths.length || paths.some((path) => !path || path.startsWith("/") || path.includes(".."))) {
    throw new Error("Evidence bundle paths must be unique safe relative paths.");
  }
  const files = input.files.map((file) => ({
    path: file.path,
    contentType: file.contentType,
    bytes: file.bytes.byteLength,
    sha256: sha256(file.bytes),
    contentBase64: file.bytes.toString("base64")
  })).sort((left, right) => left.path.localeCompare(right.path));
  const manifestFiles = files.map(({ contentBase64: _contentBase64, ...file }) => file);
  const manifest = {
    files: manifestFiles,
    overallHash: sha256(stableJson({ runId: input.runId, business: input.business, treatment: input.treatment, knownGlyphFindings: input.knownGlyphFindings, files: manifestFiles }))
  };
  const bundle: CanonicalAuthoringEvidenceBundle = {
    schemaVersion: 1,
    kind: "canonical-authoring-evidence-bundle",
    runId: input.runId,
    business: input.business,
    treatment: input.treatment,
    knownGlyphFindings: input.knownGlyphFindings,
    manifest,
    files
  };
  return { bundle, bytes: Buffer.from(stableJson(bundle)) };
}

export function verifyCanonicalAuthoringEvidenceBundle(bytes: Buffer) {
  const bundle = JSON.parse(bytes.toString("utf8")) as CanonicalAuthoringEvidenceBundle;
  if (bundle.schemaVersion !== 1 || bundle.kind !== "canonical-authoring-evidence-bundle" || !Array.isArray(bundle.files)) {
    throw new Error("Canonical authoring evidence bundle has an unsupported shape.");
  }
  const paths = bundle.files.map((file) => file.path);
  if (new Set(paths).size !== paths.length) throw new Error(`Evidence bundle ${bundle.runId} contains duplicate paths.`);
  for (const file of bundle.files) {
    const content = Buffer.from(file.contentBase64, "base64");
    if (content.byteLength !== file.bytes || sha256(content) !== file.sha256) {
      throw new Error(`Evidence bundle ${bundle.runId} failed file verification at ${file.path}.`);
    }
  }
  const manifestFiles = bundle.files.map(({ contentBase64: _contentBase64, ...file }) => file);
  if (stableJson(manifestFiles) !== stableJson(bundle.manifest.files)) {
    throw new Error(`Evidence bundle ${bundle.runId} manifest file inventory diverged.`);
  }
  const overallHash = sha256(stableJson({
    runId: bundle.runId,
    business: bundle.business,
    treatment: bundle.treatment,
    knownGlyphFindings: bundle.knownGlyphFindings,
    files: manifestFiles
  }));
  if (overallHash !== bundle.manifest.overallHash) throw new Error(`Evidence bundle ${bundle.runId} overall hash failed.`);
  for (const required of ["database/run.json", "database/site.json", "artifact/", "workspace/", "runtime/", "fonts/original/", "evaluation/EVALUATION.md"]) {
    if (!paths.some((path) => required.endsWith("/") ? path.startsWith(required) : path === required)) {
      throw new Error(`Evidence bundle ${bundle.runId} is missing ${required}.`);
    }
  }
  return bundle;
}

export function verifyCanonicalAuthoringEvidenceProvenance(bundle: CanonicalAuthoringEvidenceBundle) {
  const files = new Map(bundle.files.map((file) => [file.path, file]));
  const artifactRow = jsonRecord(requiredFile(files, "database/artifact.json"));
  const artifact = jsonRecord(artifactRow.artifact);
  const artifactFiles = arrayOfRecords(artifact.files);
  for (const file of artifactFiles) {
    const path = stringField(file, "path");
    const archived = requiredFile(files, `artifact/${path}`);
    if (
      archived.bytes !== numberField(file, "bytes")
      || archived.sha256 !== stringField(file, "contentHash")
      || archived.contentType !== stringField(file, "contentType")
    ) throw new Error(`Evidence bundle ${bundle.runId} artifact file metadata diverged at ${path}.`);
  }
  const artifactHash = sha256(stableJson({
    files: artifactFiles.map((file) => ({
      path: stringField(file, "path"),
      contentType: stringField(file, "contentType"),
      contentHash: stringField(file, "contentHash"),
      bytes: numberField(file, "bytes")
    })),
    routes: artifact.routes,
    factBindings: artifact.factBindings,
    capabilityBindings: artifact.capabilityBindings,
    runtimeSeriesId: artifact.runtimeSeriesId
  }));
  if (artifactHash !== artifact.artifactHash || artifactHash !== artifactRow.artifact_hash) {
    throw new Error(`Evidence bundle ${bundle.runId} artifact hash failed.`);
  }

  const workspace = jsonRecord(requiredFile(files, "database/workspace-revision.json"));
  const archiveKey = stringField(workspace, "source_archive_key");
  const archive = requiredFile(files, `workspace/${archiveKey}`);
  const sidecar = workspaceSourceSidecarSchema.parse(jsonValue(requiredFile(files, `workspace/${workspaceSourceSidecarKey(archiveKey)}`)));
  if (
    sidecar.archiveKey !== archiveKey
    || sidecar.archiveHash !== archive.sha256
    || sidecar.sourceHash !== workspace.source_hash
  ) throw new Error(`Evidence bundle ${bundle.runId} workspace provenance failed.`);

  const runtimePatch = jsonRecord(requiredFile(files, "database/runtime-patch.json"));
  const runtime = requiredFile(files, "runtime/runtime.js");
  if (runtime.sha256 !== runtimePatch.content_hash) {
    throw new Error(`Evidence bundle ${bundle.runId} runtime hash failed.`);
  }
  const runtimeIdentity = `${stringField(artifactRow, "runtime_series_id")}:${stringField(runtimePatch, "id")}:${stringField(runtimePatch, "content_hash")}`;

  const fontManifest = jsonRecord(jsonValue(requiredFile(files, "fonts/original/coverage-manifest.json")));
  const fontRecords = arrayOfRecords(fontManifest.fonts);
  if (fontManifest.schemaVersion !== 1 || fontRecords.length !== 6) {
    throw new Error(`Evidence bundle ${bundle.runId} original font manifest is invalid.`);
  }
  for (const font of fontRecords) {
    const filename = stringField(font, "filename");
    const archived = requiredFile(files, `fonts/original/${filename}`);
    if (archived.sha256 !== `sha256:${stringField(font, "sha256")}`) {
      throw new Error(`Evidence bundle ${bundle.runId} original font hash failed for ${filename}.`);
    }
  }
  return { artifactHash: artifactHash as `sha256:${string}`, runtimeIdentity, sourceHash: sidecar.sourceHash };
}

function requiredFile(files: Map<string, EvidenceBundleFile>, path: string) {
  const file = files.get(path);
  if (!file) throw new Error(`Evidence bundle is missing ${path}.`);
  return file;
}

function jsonValue(file: EvidenceBundleFile) {
  try {
    return JSON.parse(Buffer.from(file.contentBase64, "base64").toString("utf8")) as unknown;
  } catch {
    throw new Error(`Evidence JSON is invalid at ${file.path}.`);
  }
}

function jsonRecord(value: unknown): Record<string, unknown>;
function jsonRecord(file: EvidenceBundleFile): Record<string, unknown>;
function jsonRecord(value: unknown | EvidenceBundleFile) {
  const parsed = value && typeof value === "object" && "contentBase64" in value
    ? jsonValue(value as EvidenceBundleFile)
    : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Evidence record is invalid.");
  return parsed as Record<string, unknown>;
}

function arrayOfRecords(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Evidence record array is invalid.");
  return value.map((entry) => jsonRecord(entry));
}

function stringField(value: Record<string, unknown>, key: string) {
  const field = value[key];
  if (typeof field !== "string" || !field) throw new Error(`Evidence field ${key} is invalid.`);
  return field;
}

function numberField(value: Record<string, unknown>, key: string) {
  const field = value[key];
  if (!Number.isSafeInteger(field) || Number(field) < 0) throw new Error(`Evidence field ${key} is invalid.`);
  return Number(field);
}
