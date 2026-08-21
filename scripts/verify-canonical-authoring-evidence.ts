import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sha256, stableJson } from "../packages/business-data";
import { artifactBlobStores, workspaceSourceSidecarKey } from "../packages/site-artifacts";
import {
  createCanonicalAuthoringEvidenceBundle,
  readCanonicalAuthoringEvidenceRegistry,
  verifyCanonicalAuthoringEvidenceBundle,
  verifyCanonicalAuthoringEvidenceProvenance
} from "../packages/site-evidence";

const artifactBytes = Buffer.from("<!doctype html><title>fixture</title>");
const runtimeBytes = Buffer.from("fixture runtime");
const workspaceBytes = Buffer.from("fixture workspace archive");
const workspaceFile = { path: "src/App.tsx", content: "export default function App() { return null; }" };
const workspaceSourceHash = sha256(stableJson([workspaceFile]));
const workspaceArchiveKey = `workspace-backups/${"a".repeat(64)}.tar.gz`;
const workspaceSidecar = {
  schemaVersion: 1,
  backupId: "a".repeat(64),
  archiveKey: workspaceArchiveKey,
  archiveHash: sha256(workspaceBytes),
  sandboxRevision: "fixture",
  sourceHash: workspaceSourceHash,
  files: [{ ...workspaceFile, contentHash: sha256(Buffer.from(workspaceFile.content)), bytes: Buffer.byteLength(workspaceFile.content) }],
  createdAt: "2026-08-21T00:00:00.000Z"
};
const artifactFiles = [{
  path: "index.html",
  contentType: "text/html; charset=utf-8",
  contentHash: sha256(artifactBytes),
  bytes: artifactBytes.byteLength,
  storageKey: "site-artifacts/site/artifact/index.html"
}];
const artifactDocument = {
  artifactHash: sha256(stableJson({ files: artifactFiles.map(({ storageKey: _storageKey, ...file }) => file), routes: [], factBindings: [], capabilityBindings: [], runtimeSeriesId: "site-runtime-v4" })),
  files: artifactFiles,
  routes: [],
  factBindings: [],
  capabilityBindings: [],
  runtimeSeriesId: "site-runtime-v4"
};
const fontNames = ["inter", "figtree", "manrope", "newsreader", "fraunces", "roboto-condensed"];
const fontFiles = fontNames.map((name) => {
  const bytes = Buffer.from(`fixture font ${name}`);
  return { name, filename: `${name}.woff2`, bytes, sha256: sha256(bytes).slice(7) };
});
const requiredFiles = [
  { path: "database/run.json", contentType: "application/json", bytes: Buffer.from("{}") },
  { path: "database/site.json", contentType: "application/json", bytes: Buffer.from("{}") },
  { path: "database/artifact.json", contentType: "application/json", bytes: Buffer.from(stableJson({ artifact: artifactDocument, artifact_hash: artifactDocument.artifactHash, runtime_series_id: "site-runtime-v4" })) },
  { path: "database/workspace-revision.json", contentType: "application/json", bytes: Buffer.from(stableJson({ source_archive_key: workspaceArchiveKey, source_hash: workspaceSourceHash })) },
  { path: "database/runtime-patch.json", contentType: "application/json", bytes: Buffer.from(stableJson({ id: "runtime_patch_fixture", content_hash: sha256(runtimeBytes) })) },
  { path: "artifact/index.html", contentType: "text/html; charset=utf-8", bytes: artifactBytes },
  { path: `workspace/${workspaceArchiveKey}`, contentType: "application/gzip", bytes: workspaceBytes },
  { path: `workspace/${workspaceSourceSidecarKey(workspaceArchiveKey)}`, contentType: "application/json", bytes: Buffer.from(stableJson(workspaceSidecar)) },
  { path: "runtime/runtime.js", contentType: "application/javascript", bytes: runtimeBytes },
  ...fontFiles.map((font) => ({ path: `fonts/original/${font.filename}`, contentType: "font/woff2", bytes: font.bytes })),
  { path: "fonts/original/coverage-manifest.json", contentType: "application/json", bytes: Buffer.from(stableJson({ schemaVersion: 1, fonts: fontFiles.map(({ filename, sha256: hash }) => ({ filename, sha256: hash })) })) },
  { path: "evaluation/EVALUATION.md", contentType: "text/markdown", bytes: Buffer.from("fixture") }
];
const created = createCanonicalAuthoringEvidenceBundle({
  runId: "run_fixture",
  business: "kind",
  treatment: "optimized-v4",
  knownGlyphFindings: [{ character: "✳", codepoint: "U+2733", location: "hero" }],
  files: requiredFiles
});
assert.equal(verifyCanonicalAuthoringEvidenceBundle(created.bytes).manifest.files.length, requiredFiles.length);
assert.deepEqual(verifyCanonicalAuthoringEvidenceProvenance(verifyCanonicalAuthoringEvidenceBundle(created.bytes)), {
  artifactHash: artifactDocument.artifactHash,
  runtimeIdentity: `site-runtime-v4:runtime_patch_fixture:${sha256(runtimeBytes)}`,
  sourceHash: workspaceSourceHash
});
const tampered = Buffer.from(created.bytes);
tampered[tampered.length - 2] = tampered[tampered.length - 2] === 65 ? 66 : 65;
assert.throws(() => verifyCanonicalAuthoringEvidenceBundle(tampered));
assert.throws(() => createCanonicalAuthoringEvidenceBundle({
  runId: "run_duplicate",
  business: "kind",
  treatment: "r8-control",
  knownGlyphFindings: [],
  files: [requiredFiles[0], requiredFiles[0]]
}), /unique safe relative paths/);

const { registry } = await readCanonicalAuthoringEvidenceRegistry();
assert.equal(registry.runs.length, 8);
assert.equal(new Set(registry.runs.map((entry) => entry.runId)).size, 8);
assert.deepEqual(artifactBlobStores, ["artifact", "workspace"], "Evidence was added to the audited artifact-store union.");
const [storeSource, viewerSource, resetSource] = await Promise.all([
  readFile("packages/site-evidence/store.ts", "utf8"),
  readFile("scripts/view-canonical-authoring-evidence.ts", "utf8"),
  readFile("scripts/reset-prelaunch-site-authoring.ts", "utf8")
]);
assert(storeSource.includes("LODESTA_EVIDENCE_BUCKET") && storeSource.includes("bucket === artifactBucket || bucket === workspaceBucket"));
assert(viewerSource.includes('server.listen(port, "127.0.0.1"') && viewerSource.includes("mutationRejected"));
assert(viewerSource.includes('pathname.startsWith("/_lodesta/assets/")') && viewerSource.includes("assets/by-revision/"));
assert(resetSource.includes("verifyCanonicalAuthoringEvidenceRegistry"), "The reset is not fenced on all sealed evidence bundles.");

console.log(JSON.stringify({ ok: true, decisiveRuns: registry.runs.length, tamperDetection: "pass", storageIsolation: "pass" }));
