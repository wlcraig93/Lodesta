import { sha256, stableJson } from "@/packages/business-data";
import {
  configuredArtifactBlobStore,
  workspaceSourceSidecarKey,
  workspaceSourceSidecarSchema,
  type ArtifactBlobStore
} from "@/packages/site-artifacts";
import type { SitePlatformRepository } from "@/packages/platform-data";
import type {
  AssetRevision,
  SiteBuildArtifact,
  SiteWorkspaceRevision,
  TrustedRuntimePatch
} from "@/packages/site-contracts";

export type SiteReleaseVerificationStatus = "verified" | "integrity_failed" | "storage_unavailable";

export type SiteReleaseVerificationIssue = {
  dependency: "artifact" | "asset" | "runtime" | "workspace";
  reason: "missing" | "hash_mismatch" | "size_mismatch" | "manifest_invalid" | "storage_unavailable";
  referenceId: string;
  storageKey: string;
};

export type SiteReleaseVerificationResult = {
  status: SiteReleaseVerificationStatus;
  checkedAt: string;
  checkedObjects: number;
  issues: SiteReleaseVerificationIssue[];
};

type BlobExpectation = {
  dependency: SiteReleaseVerificationIssue["dependency"];
  referenceId: string;
  storageKey: string;
  contentHash: string;
  bytes?: number;
};

export class SiteReleaseVerificationError extends Error {
  readonly name = "SiteReleaseVerificationError";

  constructor(readonly result: SiteReleaseVerificationResult) {
    super(result.status === "storage_unavailable"
      ? "candidate_release_storage_unavailable"
      : "candidate_release_integrity_failed");
  }
}

export async function verifySiteCandidateRelease(input: {
  versionId: string;
  repository: SitePlatformRepository;
  blobStore?: ArtifactBlobStore;
  concurrency?: number;
  attempts?: number;
}): Promise<SiteReleaseVerificationResult> {
  const version = await input.repository.getSiteVersion(input.versionId);
  if (!version) throw new Error("Site version not found.");
  const [artifact, workspace, assets] = await Promise.all([
    input.repository.getBuildArtifact(version.artifactId),
    input.repository.getWorkspaceRevision(version.workspaceRevisionId),
    Promise.all(version.assetRevisionIds.map((assetId) => input.repository.getAssetRevision(assetId)))
  ]);
  const runtimePatch = artifact
    ? await input.repository.getRuntimePatch(artifact.runtimePatchAtFinalization)
    : undefined;
  if (!artifact || !workspace || !runtimePatch || assets.some((asset) => !asset)) {
    const issues: SiteReleaseVerificationIssue[] = [];
    if (!artifact) issues.push(missingManifest("artifact", version.artifactId));
    if (!workspace) issues.push(missingManifest("workspace", version.workspaceRevisionId));
    if (!runtimePatch) issues.push(missingManifest("runtime", artifact?.runtimePatchAtFinalization ?? version.artifactId));
    version.assetRevisionIds.forEach((assetId, index) => {
      if (!assets[index]) issues.push(missingManifest("asset", assetId));
    });
    return {
      status: "integrity_failed",
      checkedAt: new Date().toISOString(),
      checkedObjects: 0,
      issues
    };
  }
  return verifyPreparedSiteRelease({
    artifact,
    workspace,
    assets: assets as AssetRevision[],
    runtimePatch,
    blobStore: input.blobStore,
    concurrency: input.concurrency,
    attempts: input.attempts
  });
}

export async function verifyPreparedSiteRelease(input: {
  artifact: SiteBuildArtifact;
  workspace: SiteWorkspaceRevision;
  assets: AssetRevision[];
  runtimePatch: TrustedRuntimePatch;
  blobStore?: ArtifactBlobStore;
  concurrency?: number;
  attempts?: number;
}): Promise<SiteReleaseVerificationResult> {
  let store: ArtifactBlobStore;
  try {
    store = input.blobStore ?? configuredArtifactBlobStore();
  } catch {
    return unavailableResult("workspace", input.workspace.id, workspaceSourceSidecarKey(input.workspace.sourceArchiveKey));
  }

  const expectations: BlobExpectation[] = [
    ...input.artifact.files.map((file) => ({
      dependency: "artifact" as const,
      referenceId: input.artifact.id,
      storageKey: file.storageKey,
      contentHash: file.contentHash,
      bytes: file.bytes
    })),
    ...input.assets.map((asset) => ({
      dependency: "asset" as const,
      referenceId: asset.id,
      storageKey: asset.storageKey,
      contentHash: asset.contentHash,
      bytes: asset.bytes
    })),
    {
      dependency: "runtime" as const,
      referenceId: input.runtimePatch.id,
      storageKey: input.runtimePatch.storageKey,
      contentHash: input.runtimePatch.contentHash
    }
  ];
  const { records, conflicts } = canonicalExpectations(expectations);
  const issues = [...conflicts];
  const checked = await mapBounded(
    records,
    input.concurrency ?? 8,
    (record) => verifyBlob(store, record, input.attempts ?? 3)
  );
  issues.push(...checked.flatMap((result) => result ? [result] : []));
  issues.push(...await verifyWorkspaceSidecar(store, input.workspace, input.attempts ?? 3));
  return {
    status: issues.some((candidate) => candidate.reason === "storage_unavailable")
      ? "storage_unavailable"
      : issues.length
        ? "integrity_failed"
        : "verified",
    checkedAt: new Date().toISOString(),
    checkedObjects: records.length + 1,
    issues
  };
}

async function verifyBlob(
  store: ArtifactBlobStore,
  record: BlobExpectation,
  attempts: number
): Promise<SiteReleaseVerificationIssue | undefined> {
  const read = await readWithRetries(store, record.storageKey, attempts);
  if (read.kind === "unavailable") return { ...recordIdentity(record), reason: "storage_unavailable" };
  if (!read.blob) return { ...recordIdentity(record), reason: "missing" };
  if (read.blob.contentHash !== record.contentHash || sha256(read.blob.bytes) !== record.contentHash) {
    return { ...recordIdentity(record), reason: "hash_mismatch" };
  }
  if (record.bytes !== undefined && read.blob.bytes.byteLength !== record.bytes) {
    return { ...recordIdentity(record), reason: "size_mismatch" };
  }
  return undefined;
}

async function verifyWorkspaceSidecar(
  store: ArtifactBlobStore,
  workspace: SiteWorkspaceRevision,
  attempts: number
): Promise<SiteReleaseVerificationIssue[]> {
  const storageKey = workspaceSourceSidecarKey(workspace.sourceArchiveKey);
  const identity = { dependency: "workspace" as const, referenceId: workspace.id, storageKey };
  const read = await readWithRetries(store, storageKey, attempts);
  if (read.kind === "unavailable") return [{ ...identity, reason: "storage_unavailable" }];
  if (!read.blob) return [{ ...identity, reason: "missing" }];
  try {
    if (sha256(read.blob.bytes) !== read.blob.contentHash) return [{ ...identity, reason: "hash_mismatch" }];
    const sidecar = workspaceSourceSidecarSchema.parse(JSON.parse(read.blob.bytes.toString("utf8")));
    const matches = sidecar.archiveKey === workspace.sourceArchiveKey
      && sidecar.sourceHash === workspace.sourceHash
      && stableJson(sidecar.files.map(({ path, contentHash, bytes }) => ({ path, contentHash, bytes })))
        === stableJson(workspace.files);
    return matches ? [] : [{ ...identity, reason: "manifest_invalid" }];
  } catch {
    return [{ ...identity, reason: "manifest_invalid" }];
  }
}

async function readWithRetries(store: ArtifactBlobStore, storageKey: string, attempts: number) {
  const count = Math.max(1, Math.min(attempts, 5));
  for (let attempt = 1; attempt <= count; attempt += 1) {
    try {
      return { kind: "read" as const, blob: await store.get(storageKey) };
    } catch {
      if (attempt === count) return { kind: "unavailable" as const };
      await delay(attempt * 100);
    }
  }
  return { kind: "unavailable" as const };
}

function canonicalExpectations(expectations: BlobExpectation[]) {
  const byKey = new Map<string, BlobExpectation>();
  const conflicts: SiteReleaseVerificationIssue[] = [];
  for (const expectation of expectations) {
    const current = byKey.get(expectation.storageKey);
    if (!current) {
      byKey.set(expectation.storageKey, expectation);
      continue;
    }
    if (current.contentHash !== expectation.contentHash || current.bytes !== expectation.bytes) {
      conflicts.push({ ...recordIdentity(expectation), reason: "manifest_invalid" });
    }
  }
  return { records: [...byKey.values()], conflicts };
}

async function mapBounded<T, R>(values: T[], concurrency: number, operation: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(Math.floor(concurrency), 16, values.length || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await operation(values[index]!);
    }
  }));
  return results;
}

function recordIdentity(record: BlobExpectation) {
  return {
    dependency: record.dependency,
    referenceId: record.referenceId,
    storageKey: record.storageKey
  };
}

function missingManifest(dependency: SiteReleaseVerificationIssue["dependency"], referenceId: string) {
  return { dependency, reason: "manifest_invalid" as const, referenceId, storageKey: "unavailable" };
}

function unavailableResult(
  dependency: SiteReleaseVerificationIssue["dependency"],
  referenceId: string,
  storageKey: string
): SiteReleaseVerificationResult {
  return {
    status: "storage_unavailable",
    checkedAt: new Date().toISOString(),
    checkedObjects: 0,
    issues: [{ dependency, reason: "storage_unavailable", referenceId, storageKey }]
  };
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
