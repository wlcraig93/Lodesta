import { sha256, stableJson } from "@/packages/business-data";
import { decodeRetainedSourceResource, type RetainedSourceResource } from "@/packages/business-data/source-mirror";
import {
  assetRevisionRefSchema,
  assetRevisionSchema,
  type AssetRevision,
  type AssetRevisionRef,
  type SourceSnapshot,
  type SourceSnapshotPage
} from "@/packages/site-contracts";
import {
  logoPresentationRecipeVersion,
  prepareLogoPresentation,
  type PreparedLogoPresentation,
  type UnusableLogoPresentation
} from "./logo-preparation";
import { rankSourceAssetCandidates, type SourceAssetCandidate } from "./source-resource-ranking";

type SourceLogoMimeType = "image/png" | "image/jpeg" | "image/webp";

export type SourceLogoMaterialization = {
  status: "prepared";
  presentation: PreparedLogoPresentation;
  bytes: Buffer;
  mimeType: SourceLogoMimeType;
  contentHash: `sha256:${string}`;
  revisionIdentity: {
    sourceRevisionId: string;
    sourceContentHash: `sha256:${string}`;
    logoPresentationRecipeVersion: typeof logoPresentationRecipeVersion;
  };
  preparation: {
    processor: "sharp";
    recipe: "logo-presentation";
    recipeVersion: typeof logoPresentationRecipeVersion;
    sourceContentHash: `sha256:${string}`;
    operations: PreparedLogoPresentation["operations"];
    sourceWidth: number;
    sourceHeight: number;
    contentBounds: PreparedLogoPresentation["contentBounds"];
    backgroundColor?: string;
    confidence: number;
  };
};

export type CanonicalSourceLogo = {
  status: "canonical";
  candidate: SourceAssetCandidate;
  materialization: SourceLogoMaterialization;
  revision: AssetRevision;
  ref: AssetRevisionRef;
};

export type CanonicalSourceLogoUnavailable = {
  status: "unavailable";
  reason: "no_logo_candidate" | "logo_candidates_unusable";
  unusableCandidates: Array<{ resourceId: string; reason: UnusableLogoPresentation["reason"] }>;
};

export async function materializeSourceLogo(input: {
  bytes: Buffer;
  mimeType: SourceLogoMimeType;
  sourceRevisionId: string;
  sourceContentHash: `sha256:${string}`;
}): Promise<SourceLogoMaterialization | UnusableLogoPresentation> {
  const presentation = await prepareLogoPresentation({ bytes: input.bytes, mimeType: input.mimeType });
  if (presentation.status === "unusable") return presentation;
  const bytes = presentation.bytes;
  return {
    status: "prepared",
    presentation,
    bytes,
    mimeType: presentation.mimeType,
    contentHash: presentation.changed ? sha256(bytes) : input.sourceContentHash,
    revisionIdentity: {
      sourceRevisionId: input.sourceRevisionId,
      sourceContentHash: input.sourceContentHash,
      logoPresentationRecipeVersion
    },
    preparation: {
      processor: "sharp",
      recipe: "logo-presentation",
      recipeVersion: logoPresentationRecipeVersion,
      sourceContentHash: input.sourceContentHash,
      operations: presentation.operations,
      sourceWidth: presentation.sourceWidth,
      sourceHeight: presentation.sourceHeight,
      contentBounds: presentation.contentBounds,
      ...(presentation.backgroundColor ? { backgroundColor: presentation.backgroundColor } : {}),
      confidence: presentation.confidence
    }
  };
}

export function sourceLogoPreparedRevisionId(input: {
  sourceRevisionId: string;
  sourceContentHash: `sha256:${string}`;
}) {
  return deterministicId("asset_revision", {
    sourceRevisionId: input.sourceRevisionId,
    sourceContentHash: input.sourceContentHash,
    logoPresentationRecipeVersion
  });
}

export function canonicalSourceLogoAssetId(businessId: string) {
  return deterministicId("asset", { businessId, role: "canonical-source-logo" });
}

export function canonicalSourceLogoRevisionId(input: {
  sourceSnapshotId: string;
  sourceContentHash: `sha256:${string}`;
}) {
  return deterministicId("asset_revision", {
    sourceSnapshotId: input.sourceSnapshotId,
    sourceContentHash: input.sourceContentHash,
    logoPresentationRecipeVersion
  });
}

/**
 * Selects and materializes exactly one source logo. Raw crawl resources remain
 * immutable evidence; callers persist only this canonical presentation asset.
 */
export async function materializeCanonicalSourceLogo(input: {
  snapshot: SourceSnapshot;
  resources: RetainedSourceResource[];
  pages: SourceSnapshotPage[];
  businessName: string;
}): Promise<CanonicalSourceLogo | CanonicalSourceLogoUnavailable> {
  const candidates = rankSourceAssetCandidates({
    resources: input.resources.map(({ resource }) => resource),
    pages: input.pages
  }).filter((candidate) => candidate.likelyKind === "logo");
  if (!candidates.length) {
    return { status: "unavailable", reason: "no_logo_candidate", unusableCandidates: [] };
  }

  const retainedById = new Map(input.resources.map((entry) => [entry.resource.id, entry]));
  const unusableCandidates: CanonicalSourceLogoUnavailable["unusableCandidates"] = [];
  for (const candidate of candidates) {
    const retained = retainedById.get(candidate.resource.id);
    if (!retained?.bytes || !candidate.resource.rawContentHash) continue;
    const mimeType = candidate.resource.contentType?.split(";", 1)[0]?.trim().toLowerCase();
    if (mimeType !== "image/png" && mimeType !== "image/jpeg" && mimeType !== "image/webp") continue;
    let raw: Buffer;
    try {
      raw = decodeRetainedSourceResource(candidate.resource, retained.bytes);
    } catch {
      unusableCandidates.push({ resourceId: candidate.resource.id, reason: "decode_failed" });
      continue;
    }
    const materialization = await materializeSourceLogo({
      bytes: raw,
      mimeType,
      sourceRevisionId: candidate.resource.id,
      sourceContentHash: asContentHash(candidate.resource.rawContentHash)
    });
    if (materialization.status === "unusable") {
      unusableCandidates.push({ resourceId: candidate.resource.id, reason: materialization.reason });
      continue;
    }

    const assetId = canonicalSourceLogoAssetId(input.snapshot.businessId);
    const revisionId = canonicalSourceLogoRevisionId({
      sourceSnapshotId: input.snapshot.id,
      sourceContentHash: asContentHash(candidate.resource.rawContentHash)
    });
    const storageKey = `site-assets/${input.snapshot.businessId}/source-logo/${revisionId}/${materialization.contentHash.slice("sha256:".length)}`;
    const revision = assetRevisionSchema.parse({
      schemaVersion: 1,
      id: revisionId,
      assetId,
      businessId: input.snapshot.businessId,
      contentHash: materialization.contentHash,
      storageKey,
      mimeType: materialization.mimeType,
      bytes: materialization.bytes.byteLength,
      width: materialization.presentation.width,
      height: materialization.presentation.height,
      origin: "source_website",
      provenance: {
        origin: "source_website",
        sourceUrl: candidate.resource.finalUrl ?? candidate.resource.requestedUrl,
        sourcePageUrl: candidate.sourcePageUrl,
        sourceSnapshotId: input.snapshot.id,
        alt: `${input.businessName} logo`,
        preparation: materialization.preparation
      },
      createdAt: input.snapshot.capturedAt
    });
    const ref = assetRevisionRefSchema.parse({
      assetId,
      revisionId,
      kind: "logo",
      contentHash: revision.contentHash,
      storageKey: revision.storageKey,
      mimeType: revision.mimeType,
      alt: `${input.businessName} logo`,
      width: revision.width,
      height: revision.height,
      origin: "source_website",
      sourceFactIds: [],
      activeForFutureBuilds: true
    });
    return { status: "canonical", candidate, materialization, revision, ref };
  }

  return { status: "unavailable", reason: "logo_candidates_unusable", unusableCandidates };
}

function deterministicId(prefix: string, value: unknown) {
  return `${prefix}_${sha256(stableJson(value)).slice("sha256:".length, "sha256:".length + 32)}`;
}

function asContentHash(value: string) {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error("Expected a SHA-256 content hash.");
  return value as `sha256:${string}`;
}
