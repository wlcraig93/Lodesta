import {
  ingestWebsite,
  sha256,
  stableJson,
  type WebsiteIngestionResult
} from "@/packages/business-data";
import type { ArtifactBlobStore } from "@/packages/site-artifacts";
import {
  businessStateSchema,
  sourceSnapshotSchema,
  websiteSourceSnapshotPayloadSchema
} from "@/packages/site-contracts";
import { materializeCanonicalSourceLogo, type CanonicalSourceLogo } from "./source-logo-materialization";

export const websiteSourcePreparationDeadlineMs = 20 * 60_000;

export async function prepareWebsiteSource(input: {
  url: string;
  siteId: string;
  businessId: string;
  blobStore: ArtifactBlobStore;
  signal?: AbortSignal;
  ingest?: typeof ingestWebsite;
}): Promise<WebsiteIngestionResult & { canonicalSourceLogo?: CanonicalSourceLogo }> {
  let ingested = await (input.ingest ?? ingestWebsite)({
    url: input.url,
    siteId: input.siteId,
    businessId: input.businessId,
    signal: input.signal
  });
  const blobPersistenceStarted = Date.now();
  await putImmutableBatch(input.blobStore, ingested.retainedSourceResources.flatMap(({ resource, bytes }) =>
    resource.storageKey && resource.blobContentHash && bytes
      ? [{
          key: resource.storageKey,
          bytes,
          contentType: resource.storedEncoding === "gzip" ? "application/gzip" : resource.contentType ?? "application/octet-stream",
          contentHash: asContentHash(resource.blobContentHash)
        }]
      : []
  ), input.signal);
  const snapshot = ingested.sourceSnapshots[0];
  if (!snapshot) throw new Error("source_preparation_snapshot_missing");
  const canonicalSourceLogo = await materializeCanonicalSourceLogo({
    snapshot,
    resources: ingested.retainedSourceResources,
    pages: ingested.sourceSnapshotPages,
    businessName: ingested.state.identity.name
  });
  if (canonicalSourceLogo.status === "canonical") {
    await putImmutableWithRetry(input.blobStore, {
      key: canonicalSourceLogo.revision.storageKey,
      bytes: canonicalSourceLogo.materialization.bytes,
      contentType: canonicalSourceLogo.revision.mimeType,
      contentHash: asContentHash(canonicalSourceLogo.revision.contentHash)
    }, input.signal);
    const { stateHash: _stateHash, ...stateWithoutHash } = ingested.state;
    const nextStateWithoutHash = {
      ...stateWithoutHash,
      assets: [canonicalSourceLogo.ref]
    };
    ingested = {
      ...ingested,
      state: businessStateSchema.parse({
        ...nextStateWithoutHash,
        stateHash: sha256(stableJson(nextStateWithoutHash))
      })
    };
  }
  ingested = withSourceMirrorPersistenceTiming(ingested, Date.now() - blobPersistenceStarted);
  return {
    ...ingested,
    ...(canonicalSourceLogo.status === "canonical" ? { canonicalSourceLogo } : {})
  };
}

function asContentHash(value: string) {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error("Expected a SHA-256 content hash.");
  return value as `sha256:${string}`;
}

async function putImmutableBatch(
  store: ArtifactBlobStore,
  blobs: Array<Parameters<ArtifactBlobStore["putImmutable"]>[0]>,
  signal?: AbortSignal
) {
  const uniqueBlobs = new Map<string, Parameters<ArtifactBlobStore["putImmutable"]>[0]>();
  for (const blob of blobs) {
    const retained = uniqueBlobs.get(blob.key);
    if (retained && retained.contentHash !== blob.contentHash) throw new Error(`Immutable source blob key collision at ${blob.key}.`);
    uniqueBlobs.set(blob.key, retained ?? blob);
  }
  const pending = [...uniqueBlobs.values()];
  const concurrency = 24;
  for (let index = 0; index < pending.length; index += concurrency) {
    await Promise.all(pending.slice(index, index + concurrency).map((blob) => putImmutableWithRetry(store, blob, signal)));
  }
}

async function putImmutableWithRetry(
  store: ArtifactBlobStore,
  blob: Parameters<ArtifactBlobStore["putImmutable"]>[0],
  signal?: AbortSignal
) {
  let retainedError: unknown;
  const maximumAttempts = 5;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    if (signal?.aborted) throw signal.reason ?? new Error("source_preparation_deadline_exhausted");
    try {
      await store.putImmutable(blob);
      return;
    } catch (error) {
      retainedError = error;
      if (!transientImmutableWriteError(error) || attempt === maximumAttempts) throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500 * 2 ** (attempt - 1)));
    }
  }
  throw retainedError;
}

function withSourceMirrorPersistenceTiming(input: WebsiteIngestionResult, blobPersistenceMs: number): WebsiteIngestionResult {
  const completedAt = new Date().toISOString();
  return {
    ...input,
    sourceSnapshots: input.sourceSnapshots.map((snapshot) => {
      const payload = websiteSourceSnapshotPayloadSchema.safeParse(snapshot.payload);
      if (!payload.success) return snapshot;
      return sourceSnapshotSchema.parse({
        ...snapshot,
        payload: {
          ...payload.data,
          stages: {
            ...payload.data.stages,
            blobPersistenceMs: Math.max(0, Math.round(blobPersistenceMs))
          },
          completedAt,
          elapsedMs: Math.max(payload.data.elapsedMs, Date.parse(completedAt) - Date.parse(payload.data.startedAt))
        }
      });
    })
  };
}

function transientImmutableWriteError(error: unknown) {
  return /(?:failed with 5\d\d|fetch failed|network|timeout|timed out|econnreset|socket hang up)/i.test(
    error instanceof Error ? error.message : String(error)
  );
}
