import { decodeRetainedSourceResource, sha256 } from "@/packages/business-data";
import { configuredArtifactBlobStore, type ArtifactBlobStore, type ImmutableBlob } from "@/packages/site-artifacts";
import type { SitePlatformRepository } from "@/packages/platform-data";
import type { SourceSnapshotResource } from "@/packages/site-contracts";

export type SourceArchiveAuditResult = {
  snapshotId: string;
  status: "healthy" | "integrity_failed" | "storage_unavailable";
  auditedAt: string;
  resourceCount: number;
  retainedResourceCount: number;
  uniqueStorageKeyCount: number;
  issues: Array<{
    resourceId: string;
    storageKey?: string;
    reason: "manifest_invalid" | "missing" | "stored_hash_mismatch" | "raw_hash_mismatch" | "storage_unavailable";
  }>;
};

export async function auditSourceSnapshotArchive(input: {
  snapshotId: string;
  repository: SitePlatformRepository;
  blobStore?: ArtifactBlobStore;
  concurrency?: number;
  attempts?: number;
}): Promise<SourceArchiveAuditResult> {
  const attempts = input.attempts ?? 3;
  const snapshotRead = await retryOperation(() => input.repository.getSourceSnapshot(input.snapshotId), attempts);
  if (snapshotRead.kind === "unavailable") {
    return result(input.snapshotId, [], [], [{ resourceId: input.snapshotId, reason: "storage_unavailable" }]);
  }
  const snapshot = snapshotRead.value;
  if (!snapshot) throw new Error("Source snapshot is missing or not finalized.");
  const resourcesRead = await retryOperation(() => input.repository.listSourceSnapshotResources(input.snapshotId), attempts);
  if (resourcesRead.kind === "unavailable") {
    return result(input.snapshotId, [], [], [{ resourceId: input.snapshotId, reason: "storage_unavailable" }]);
  }
  const resources = resourcesRead.value;
  const retained = resources.filter((resource) => resource.outcome === "fetched" || hasAnyBlobManifest(resource));
  let store: ArtifactBlobStore;
  try {
    store = input.blobStore ?? configuredArtifactBlobStore();
  } catch {
    return result(input.snapshotId, resources, retained, retained.map((resource) => ({
      resourceId: resource.id,
      storageKey: resource.storageKey,
      reason: "storage_unavailable" as const
    })));
  }

  const reads = new Map<string, Promise<{ kind: "read"; blob: ImmutableBlob | undefined } | { kind: "unavailable" }>>();
  const invalid = retained.filter((resource) => !hasCompleteBlobManifest(resource));
  const auditable = retained.filter(hasCompleteBlobManifest);
  const issues: SourceArchiveAuditResult["issues"] = invalid.map((resource) => ({
    resourceId: resource.id,
    storageKey: resource.storageKey,
    reason: "manifest_invalid" as const
  }));
  const checked = await mapBounded(auditable, input.concurrency ?? 8, async (resource) => {
    let read = reads.get(resource.storageKey);
    if (!read) {
      read = readWithRetries(store, resource.storageKey, attempts);
      reads.set(resource.storageKey, read);
    }
    const retainedBlob = await read;
    if (retainedBlob.kind === "unavailable") return auditIssue(resource, "storage_unavailable");
    if (!retainedBlob.blob) return auditIssue(resource, "missing");
    if (
      retainedBlob.blob.contentHash !== resource.blobContentHash
      || sha256(retainedBlob.blob.bytes) !== resource.blobContentHash
      || retainedBlob.blob.bytes.byteLength !== resource.storedBytes
    ) return auditIssue(resource, "stored_hash_mismatch");
    try {
      decodeRetainedSourceResource(resource, retainedBlob.blob.bytes);
      return undefined;
    } catch {
      return auditIssue(resource, "raw_hash_mismatch");
    }
  });
  issues.push(...checked.flatMap((issue) => issue ? [issue] : []));
  return result(input.snapshotId, resources, retained, issues);
}

function hasCompleteBlobManifest(resource: SourceSnapshotResource): resource is SourceSnapshotResource & {
  storageKey: string;
  blobContentHash: `sha256:${string}`;
  rawContentHash: `sha256:${string}`;
  storedEncoding: "identity" | "gzip";
} {
  return Boolean(resource.storageKey && resource.blobContentHash && resource.rawContentHash && resource.storedEncoding);
}

function hasAnyBlobManifest(resource: SourceSnapshotResource) {
  return Boolean(resource.storageKey || resource.blobContentHash || resource.rawContentHash || resource.storedEncoding);
}

function auditIssue(resource: SourceSnapshotResource & { storageKey: string }, reason: SourceArchiveAuditResult["issues"][number]["reason"]) {
  return { resourceId: resource.id, storageKey: resource.storageKey, reason };
}

function result(
  snapshotId: string,
  resources: SourceSnapshotResource[],
  retained: SourceSnapshotResource[],
  issues: SourceArchiveAuditResult["issues"]
): SourceArchiveAuditResult {
  return {
    snapshotId,
    status: issues.some((issue) => issue.reason === "storage_unavailable")
      ? "storage_unavailable"
      : issues.length
        ? "integrity_failed"
        : "healthy",
    auditedAt: new Date().toISOString(),
    resourceCount: resources.length,
    retainedResourceCount: retained.length,
    uniqueStorageKeyCount: new Set(retained.map((resource) => resource.storageKey).filter(Boolean)).size,
    issues
  };
}

async function readWithRetries(store: ArtifactBlobStore, storageKey: string, attempts: number) {
  const read = await retryOperation(() => store.get(storageKey), attempts);
  return read.kind === "unavailable"
    ? { kind: "unavailable" as const }
    : { kind: "read" as const, blob: read.value };
}

async function retryOperation<T>(operation: () => Promise<T>, attempts: number) {
  const count = Math.max(1, Math.min(attempts, 5));
  for (let attempt = 1; attempt <= count; attempt += 1) {
    try {
      return { kind: "success" as const, value: await operation() };
    } catch {
      if (attempt === count) return { kind: "unavailable" as const };
      await new Promise<void>((resolve) => setTimeout(resolve, attempt * 100));
    }
  }
  return { kind: "unavailable" as const };
}

async function mapBounded<T, R>(values: T[], concurrency: number, operation: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length);
  let next = 0;
  const workers = Math.max(1, Math.min(Math.floor(concurrency), 16, values.length || 1));
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await operation(values[index]!);
    }
  }));
  return results;
}
