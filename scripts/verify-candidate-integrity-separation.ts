import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256, stableJson } from "../packages/business-data";
import {
  LocalArtifactBlobStore,
  serializeWorkspaceSourceSidecar,
  workspaceSourceSidecarKey,
  workspaceSourceSidecarSchema,
  type ArtifactBlobStore
} from "../packages/site-artifacts";
import type { AssetRevision, SiteBuildArtifact, SiteWorkspaceRevision, TrustedRuntimePatch } from "../packages/site-contracts";
import { verifyPreparedSiteRelease } from "../packages/site-platform/release-verification";
import { auditSourceSnapshotArchive } from "../packages/site-platform/source-archive-audit";
import type { SitePlatformRepository } from "../packages/platform-data";
import type { SourceSnapshotResource } from "../packages/site-contracts";

const directory = await mkdtemp(join(tmpdir(), "lodesta-release-verification-"));
try {
  const store = new LocalArtifactBlobStore(join(directory, "blobs"));
  const artifactBytes = Buffer.from("<!doctype html><title>Verified</title>");
  const assetBytes = Buffer.from("retained-asset");
  const runtimeBytes = Buffer.from("retained-runtime");
  const sourceFiles = [{ path: "src/App.tsx", content: "export default function App() { return <main />; }" }];
  const backupId = "a".repeat(64);
  const sourceArchiveKey = `workspace-backups/${backupId}.tar.gz`;
  const workspace: SiteWorkspaceRevision = {
    schemaVersion: 1,
    id: "workspace_revision_verifier",
    siteId: "site_verifier",
    publicBuildInputId: "input_verifier",
    ownerOperationalRevision: 1,
    ownerIntentRevision: 1,
    revisionNumber: 1,
    sourceHash: sha256(stableJson(sourceFiles)),
    sourceArchiveKey,
    files: sourceFiles.map((file) => ({ path: file.path, contentHash: sha256(file.content), bytes: Buffer.byteLength(file.content) })),
    createdAt: "2026-08-05T12:00:00.000Z",
    createdBy: { kind: "agent", id: "run_verifier" }
  };
  const artifact: SiteBuildArtifact = {
    schemaVersion: 1,
    id: "artifact_verifier",
    siteId: workspace.siteId,
    workspaceRevisionId: workspace.id,
    publicBuildInputId: workspace.publicBuildInputId,
    ownerOperationalRevision: 1,
    ownerIntentRevision: 1,
    createdAt: workspace.createdAt,
    artifactHash: sha256("artifact-manifest"),
    storagePrefix: "site-artifacts/artifact_verifier",
    files: [{
      path: "index.html",
      contentType: "text/html",
      contentHash: sha256(artifactBytes),
      bytes: artifactBytes.length,
      storageKey: "site-artifacts/artifact_verifier/index.html"
    }],
    routes: [{ path: "/", htmlFile: "index.html", title: "Verified", description: "Verified candidate" }],
    factBindings: [],
    capabilityBindings: [],
    runtimeSeriesId: "site-runtime-v4",
    runtimePatchAtFinalization: "runtime_patch_verifier",
    toolchainVersion: "test",
    sandboxImageDigest: sha256("sandbox"),
    qa: { hardGate: "passed", checkedAt: workspace.createdAt, routesChecked: 1, linksChecked: 0, findings: [], screenshotKeys: [] }
  };
  const asset: AssetRevision = {
    schemaVersion: 1,
    id: "asset_revision_verifier",
    assetId: "asset_verifier",
    businessId: "business_verifier",
    contentHash: sha256(assetBytes),
    storageKey: "assets/asset_verifier",
    mimeType: "image/png",
    bytes: assetBytes.length,
    origin: "owner_upload",
    provenance: { origin: "owner_upload", uploadedBy: "owner_verifier" },
    createdAt: workspace.createdAt
  };
  const runtimePatch: TrustedRuntimePatch = {
    schemaVersion: 1,
    id: artifact.runtimePatchAtFinalization,
    seriesId: artifact.runtimeSeriesId,
    version: "test",
    contentHash: sha256(runtimeBytes),
    storageKey: "runtime/runtime_patch_verifier.js",
    createdAt: workspace.createdAt,
    provenance: { sourceRevision: "test", builderVersion: "test" },
    securityStatus: "audited",
    compatibilityStatus: "passed"
  };
  const sidecar = workspaceSourceSidecarSchema.parse({
    schemaVersion: 1,
    backupId,
    archiveKey: sourceArchiveKey,
    archiveHash: sha256("backup"),
    sandboxRevision: "revision-1",
    sourceHash: workspace.sourceHash,
    files: sourceFiles.map((file) => ({
      ...file,
      contentHash: sha256(file.content),
      bytes: Buffer.byteLength(file.content)
    })),
    createdAt: workspace.createdAt
  });
  const sidecarBytes = serializeWorkspaceSourceSidecar(sidecar);
  await Promise.all([
    store.putImmutable({ key: artifact.files[0]!.storageKey, bytes: artifactBytes, contentType: "text/html", contentHash: sha256(artifactBytes) }),
    store.putImmutable({ key: asset.storageKey, bytes: assetBytes, contentType: asset.mimeType, contentHash: sha256(assetBytes) }),
    store.putImmutable({ key: runtimePatch.storageKey, bytes: runtimeBytes, contentType: "text/javascript", contentHash: sha256(runtimeBytes) }),
    store.putImmutable({ key: workspaceSourceSidecarKey(sourceArchiveKey), bytes: sidecarBytes, contentType: "application/json", contentHash: sha256(sidecarBytes) })
  ]);

  const prepared = { artifact, workspace, assets: [asset], runtimePatch };
  assert.equal((await verifyPreparedSiteRelease({ ...prepared, blobStore: store })).status, "verified");

  const attempts = new Map<string, number>();
  const transientStore: ArtifactBlobStore = {
    putImmutable: (blob) => store.putImmutable(blob),
    exists: (key) => store.exists(key),
    get: async (key) => {
      const count = attempts.get(key) ?? 0;
      attempts.set(key, count + 1);
      if (count === 0) throw new Error("transient transport failure");
      return store.get(key);
    }
  };
  assert.equal((await verifyPreparedSiteRelease({ ...prepared, blobStore: transientStore, attempts: 2 })).status, "verified");

  const missingStore = new LocalArtifactBlobStore(join(directory, "missing"));
  assert.equal((await verifyPreparedSiteRelease({ ...prepared, blobStore: missingStore })).status, "integrity_failed");

  const unavailableStore: ArtifactBlobStore = {
    putImmutable: async () => undefined,
    exists: async () => { throw new Error("offline"); },
    get: async () => { throw new Error("offline"); }
  };
  assert.equal((await verifyPreparedSiteRelease({ ...prepared, blobStore: unavailableStore, attempts: 2 })).status, "storage_unavailable");

  const sourceBytes = Buffer.from("retained source response");
  const sourceStorageKey = "source-snapshots/source_verifier/shared-response";
  const sourceResources: SourceSnapshotResource[] = ["resource_one", "resource_two"].map((id, index) => ({
    schemaVersion: 1,
    id,
    sourceSnapshotId: "source_verifier",
    captureKind: "http_response",
    role: "document",
    requestedUrl: `https://example.com/${index}`,
    finalUrl: `https://example.com/${index}`,
    outcome: "fetched",
    status: 200,
    contentType: "text/html",
    storedEncoding: "identity",
    rawContentHash: sha256(sourceBytes),
    blobContentHash: sha256(sourceBytes),
    storageKey: sourceStorageKey,
    rawBytes: sourceBytes.length,
    storedBytes: sourceBytes.length,
    headers: {},
    redirectChain: [],
    initiatorUrls: [],
    capturedAt: workspace.createdAt,
    metadata: {}
  }));
  const sourceRepository = {
    getSourceSnapshot: async () => ({ id: "source_verifier" }),
    listSourceSnapshotResources: async () => sourceResources
  } as unknown as SitePlatformRepository;
  let sourceReads = 0;
  const sharedSourceStore: ArtifactBlobStore = {
    putImmutable: async () => undefined,
    exists: async () => true,
    get: async (key) => {
      sourceReads += 1;
      if (sourceReads === 1) throw new Error("transient source storage error");
      return { key, bytes: sourceBytes, contentType: "text/html", contentHash: sha256(sourceBytes) };
    }
  };
  const sourceAudit = await auditSourceSnapshotArchive({
    snapshotId: "source_verifier",
    repository: sourceRepository,
    blobStore: sharedSourceStore,
    attempts: 2
  });
  assert.equal(sourceAudit.status, "healthy");
  assert.equal(sourceAudit.uniqueStorageKeyCount, 1);
  assert.equal(sourceReads, 2, "Duplicate source keys were read independently instead of sharing one retried read.");
  const missingSourceAudit = await auditSourceSnapshotArchive({
    snapshotId: "source_verifier",
    repository: sourceRepository,
    blobStore: missingStore
  });
  assert.equal(missingSourceAudit.status, "integrity_failed");
  assert(missingSourceAudit.issues.every((issue) => issue.reason === "missing"));

  console.log("candidate integrity separation verification passed");
} finally {
  await rm(directory, { recursive: true, force: true });
}
